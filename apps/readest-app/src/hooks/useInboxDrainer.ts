import { useCallback, useEffect, useRef } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { fetchWithAuth } from '@/utils/fetch';
import { getAPIBaseUrl } from '@/services/environment';
import { isTauriAppPlatform } from '@/services/environment';
import { ingestFile } from '@/services/ingestService';
import { drainInbox, DEFAULT_MAX_ITEMS_PER_PASS } from '@/services/send/inboxDrainer';
import { isInboxDrainEnabled } from '@/services/send/devicePrefs';
import {
  convertToEpubWithWorker,
  convertFileIfNeeded,
} from '@/services/send/conversion/conversionWorker';
import type { DBSendInboxItem } from '@/types/sendRecords';

const DRAIN_INTERVAL_MS = 60_000;
const DEVICE_ID_KEY = 'readest-send-device-id';

function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

/**
 * Background controller that drains the Send to Readest inbox. Mounted once in
 * the library/app shell — runs on app focus and on a 60s interval whenever a
 * user is signed in. Not part of useBooksSync: this does network downloads and
 * CPU-bound conversion that must stay off the throttled cover-sync path.
 */
export function useInboxDrainer(): void {
  const { envConfig, appService } = useEnv();
  const { user } = useAuth();
  const { settings } = useSettingsStore();
  const libraryLoaded = useLibraryStore((s) => s.libraryLoaded);
  const runningRef = useRef(false);
  const lastDrainAtRef = useRef(0);

  const runDrain = useCallback(async () => {
    if (!user || !appService || runningRef.current) return;
    // Per-device opt-out: this device does not claim/process inbox items.
    if (!isInboxDrainEnabled()) return;
    // Throttle: drain (and so claim_inbox_item) at most once per interval, so
    // the timer and focus events together never poll faster than that.
    if (Date.now() - lastDrainAtRef.current < DRAIN_INTERVAL_MS) return;
    lastDrainAtRef.current = Date.now();
    runningRef.current = true;
    try {
      const device = getDeviceId();
      const apiBase = getAPIBaseUrl();

      // All inbox state changes route through /api/send/* rather than calling
      // Supabase directly.
      const postJSON = async (path: string, body: object) => {
        const res = await fetchWithAuth(`${apiBase}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        return res.json();
      };

      const claimRow = async (): Promise<DBSendInboxItem | null> => {
        const { item } = (await postJSON('/send/inbox/claim', { device })) as {
          item: DBSendInboxItem | null;
        };
        return item;
      };

      const resolvePayload = async (item: DBSendInboxItem): Promise<File> => {
        if (item.kind === 'url') {
          const html = await fetchUrlHtml(item.url!, apiBase);
          const book = await convertToEpubWithWorker({
            kind: 'article',
            html,
            url: item.url!,
          });
          return book.file;
        }
        // file / html: download the R2 payload via the signed-URL endpoint.
        const res = await fetchWithAuth(`${apiBase}/send/inbox/${item.id}/payload`, {
          method: 'GET',
        });
        if (!res.ok) throw new Error(`Payload download failed (${res.status})`);
        const { downloadUrl } = (await res.json()) as { downloadUrl: string };
        const fileRes = await fetch(downloadUrl);
        if (!fileRes.ok) throw new Error(`Payload fetch failed (${fileRes.status})`);
        const bytes = await fileRes.arrayBuffer();
        const filename = item.filename ?? 'document';

        if (item.kind === 'html') {
          const book = await convertToEpubWithWorker({
            kind: 'html',
            bytes,
            fileName: filename,
          });
          return book.file;
        }
        // file kind: convert documents to EPUB, import native formats as-is.
        return convertFileIfNeeded(new File([bytes], filename));
      };

      const importItem = async (file: File, item: DBSendInboxItem): Promise<void> => {
        const { library } = useLibraryStore.getState();
        const book = await ingestFile(
          {
            file,
            books: library,
            subjectTag: item.subject_tag ?? undefined,
            forceUpload: true,
          },
          { appService, settings, isLoggedIn: true },
        );
        if (!book) throw new Error('Import produced no book');
        // updateBooks persists the library; useBooksSync then pushes it.
        await useLibraryStore.getState().updateBooks(envConfig, [book]);
      };

      await drainInbox(
        {
          claimItem: claimRow,
          renewClaim: async (id) => {
            const { ok } = (await postJSON(`/send/inbox/${id}/transition`, {
              action: 'renew',
              device,
            })) as { ok: boolean };
            return ok;
          },
          completeItem: async (id) => {
            const { ok } = (await postJSON(`/send/inbox/${id}/transition`, {
              action: 'complete',
              device,
            })) as { ok: boolean };
            return ok;
          },
          failItem: async (id, error) => {
            const { ok } = (await postJSON(`/send/inbox/${id}/transition`, {
              action: 'fail',
              device,
              error: error.slice(0, 500),
            })) as { ok: boolean };
            return ok;
          },
          resolvePayload,
          importItem,
        },
        DEFAULT_MAX_ITEMS_PER_PASS,
      );
    } catch (err) {
      console.warn('Inbox drain pass failed:', err);
    } finally {
      runningRef.current = false;
    }
  }, [user, appService, settings, envConfig]);

  useEffect(() => {
    // Hold off until the library has loaded — otherwise the very first
    // drained item would force `updateBooks` to fall back to its own disk
    // load. Once `libraryLoaded` flips true this effect re-runs.
    if (!user || !libraryLoaded) return;
    void runDrain();
    const interval = setInterval(() => void runDrain(), DRAIN_INTERVAL_MS);
    const onFocus = () => void runDrain();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [user, libraryLoaded, runDrain]);
}

/**
 * Fetch a page's HTML for article extraction. The browser cannot fetch
 * cross-origin pages, so web goes through the SSRF-guarded proxy; the Tauri
 * apps fetch directly.
 */
async function fetchUrlHtml(url: string, apiBase: string): Promise<string> {
  if (isTauriAppPlatform()) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Could not fetch URL (${res.status})`);
    return res.text();
  }
  const res = await fetchWithAuth(`${apiBase}/send/fetch-url?url=${encodeURIComponent(url)}`, {
    method: 'GET',
  });
  if (!res.ok) throw new Error(`Could not fetch URL (${res.status})`);
  const { html } = (await res.json()) as { html: string };
  return html;
}
