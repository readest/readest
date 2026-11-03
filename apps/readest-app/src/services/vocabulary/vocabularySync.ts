import { getAPIBaseUrl } from '@/services/environment';
import { isSyncCategoryEnabled } from '@/services/sync/syncCategories';
import { useVocabularyStore } from '@/store/vocabularyStore';
import { getAccessToken, getUserID } from '@/utils/access';
import { fetchWithTimeout } from '@/utils/fetch';
import { MAX_PULL_ROWS, MAX_PUSH_ROWS, entryToRow, rowToEntry, type VocabularyRow } from './wire';

// Client side of /api/sync/vocabulary (#789): push dirty entries, then pull
// everything changed since this device's cursor, one keyset page at a time.

const ENDPOINT = `${getAPIBaseUrl()}/sync/vocabulary`;
const CURSOR_KEY = 'readest_vocabulary_sync_cursor_v1';
// The server stamps updated_at before its write commits, so a slow write can
// land behind a cursor already handed out. Re-reading the last minute catches
// it; re-applying a row is a no-op merge.
const OVERLAP_MS = 60_000;
const PUSH_DELAY_MS = 5_000;

export interface VocabularyCursor {
  userId: string;
  ts: string;
  id: string;
}

export interface VocabularySyncDeps {
  userId: string;
  pageSize?: number;
  pushChunk?: number;
  pull(since: { ts: string; id: string } | null, limit: number): Promise<VocabularyRow[]>;
  push(rows: VocabularyRow[]): Promise<VocabularyRow[]>;
  getCursor(): VocabularyCursor | null;
  setCursor(cursor: VocabularyCursor): void;
}

export const pullVocabulary = async (deps: VocabularySyncDeps): Promise<void> => {
  const pageSize = deps.pageSize ?? MAX_PULL_ROWS;
  const saved = deps.getCursor();
  let since =
    saved && saved.userId === deps.userId
      ? { ts: new Date(Date.parse(saved.ts) - OVERLAP_MS).toISOString(), id: '' }
      : null;
  for (;;) {
    const rows = await deps.pull(since, pageSize);
    if (!rows.length) return;
    useVocabularyStore.getState().applyRemote(rows.map(rowToEntry));
    const last = rows[rows.length - 1]!;
    since = { ts: last.updated_at!, id: last.id };
    // Advance only after the page is applied, so an interrupted pull resumes.
    // Compare as times: Postgres hands back `+00:00` where the client writes `Z`.
    if (!saved || saved.userId !== deps.userId || Date.parse(since.ts) >= Date.parse(saved.ts)) {
      deps.setCursor({ userId: deps.userId, ...since });
    }
    if (rows.length < pageSize) return;
  }
};

export const pushVocabulary = async (deps: VocabularySyncDeps): Promise<void> => {
  const chunk = deps.pushChunk ?? MAX_PUSH_ROWS;
  const dirty = Object.values(useVocabularyStore.getState().entries).filter((e) => e.dirty);
  for (let i = 0; i < dirty.length; i += chunk) {
    const batch = dirty.slice(i, i + chunk);
    const merged = await deps.push(batch.map(entryToRow));
    const store = useVocabularyStore.getState();
    // Clear dirty first (only on entries unchanged since the snapshot), then
    // fold in the server's merge so it can't re-mark them.
    store.markPushed(batch);
    store.applyRemote(merged.map(rowToEntry));
  }
};

const request = async <T>(url: string, init: RequestInit = {}): Promise<T> => {
  const token = await getAccessToken();
  if (!token) throw new Error('Not authenticated');
  const res = await fetchWithTimeout(
    url,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    },
    15000,
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(`vocabulary sync failed: ${body.error || res.statusText}`);
  }
  return (await res.json()) as T;
};

const readCursor = (): VocabularyCursor | null => {
  try {
    const raw = localStorage.getItem(CURSOR_KEY);
    return raw ? (JSON.parse(raw) as VocabularyCursor) : null;
  } catch {
    return null;
  }
};

const defaultDeps = async (): Promise<VocabularySyncDeps | null> => {
  const userId = await getUserID();
  if (!userId || !(await getAccessToken())) return null;
  return {
    userId,
    pull: async (since, limit) => {
      const qs = new URLSearchParams({ limit: String(limit) });
      if (since) {
        qs.set('since_ts', since.ts);
        qs.set('since_id', since.id);
      }
      return (await request<{ rows: VocabularyRow[] }>(`${ENDPOINT}?${qs}`)).rows;
    },
    push: async (rows) =>
      (
        await request<{ rows: VocabularyRow[] }>(ENDPOINT, {
          method: 'POST',
          body: JSON.stringify({ rows }),
        })
      ).rows,
    getCursor: readCursor,
    setCursor: (cursor) => {
      try {
        localStorage.setItem(CURSOR_KEY, JSON.stringify(cursor));
      } catch {
        // No storage: the next sync just re-reads from the start.
      }
    },
  };
};

let inFlight: Promise<void> | null = null;

/** Push local changes, then pull remote ones. Skipped when signed out or the category is off. */
export const syncVocabulary = (
  makeDeps: () => Promise<VocabularySyncDeps | null> = defaultDeps,
): Promise<void> => {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      if (!isSyncCategoryEnabled('vocabulary')) return;
      const deps = await makeDeps();
      if (!deps) return;
      await pushVocabulary(deps);
      await pullVocabulary(deps);
    } catch (err) {
      console.warn('[vocabulary] sync failed', err);
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
};

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let subscribed = false;

/**
 * Start syncing for this app session: one sync now, then a debounced sync
 * after every local change. Safe to call more than once.
 */
export const initVocabularySync = (): void => {
  void syncVocabulary();
  if (subscribed) return;
  subscribed = true;
  useVocabularyStore.subscribe((state, prev) => {
    if (state.version === prev.version) return;
    if (!Object.values(state.entries).some((e) => e.dirty)) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      pushTimer = null;
      void syncVocabulary();
    }, PUSH_DELAY_MS);
  });
};
