import { create } from 'zustand';
import type { AppService } from '@/types/system';
import type {
  VocabularyEntry,
  VocabularyOccurrence,
  VocabularyState,
} from '@/services/vocabulary/types';
import {
  addOccurrence,
  entryId,
  mergeEntries,
  normalizeWordKey,
} from '@/services/vocabulary/entry';
import { readVocabularyFile, writeVocabularyFile } from '@/services/vocabulary/persistence';

const PERSIST_DELAY_MS = 500;

interface VocabularyStore {
  entries: Record<string, VocabularyEntry>;
  loaded: boolean;
  /** Bumped on every change, so Word Lens can re-render on it. */
  version: number;
  load(appService: AppService): Promise<void>;
  /** Save a dictionary lookup. Never moves modifiedAt of a live entry. */
  recordLookup(input: { word: string; lang: string; occurrence?: VocabularyOccurrence }): void;
  /** The entry id for a word, creating an empty live entry if needed. */
  ensureEntry(word: string, lang: string): string;
  setState(id: string, state: VocabularyState): void;
  setHint(id: string, hint: string): void;
  remove(id: string): void;
  /** Merge entries pulled from the server; the result isn't pushed back. */
  applyRemote(entries: VocabularyEntry[]): void;
  /** Clear `dirty` on entries unchanged since this snapshot was pushed. */
  markPushed(pushed: VocabularyEntry[]): void;
  getLearningAndMastered(lang: string): {
    learning: Map<string, string | undefined>;
    mastered: Set<string>;
  };
}

let appServiceRef: AppService | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

const schedulePersist = () => {
  if (!appServiceRef) return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    if (!appServiceRef) return;
    const entries = Object.values(useVocabularyStore.getState().entries);
    writeVocabularyFile(appServiceRef, entries).catch((err) =>
      console.warn('[vocabulary] failed to save', err),
    );
  }, PERSIST_DELAY_MS);
};

const freshEntry = (word: string, lang: string, key: string, now: number): VocabularyEntry => ({
  id: entryId(lang, key),
  lang,
  key,
  word: word.trim(),
  state: 'none',
  occurrences: [],
  createdAt: now,
  modifiedAt: now,
  deletedAt: null,
});

export const useVocabularyStore = create<VocabularyStore>((set, get) => {
  const put = (next: VocabularyEntry[]) => {
    set((s) => {
      const entries = { ...s.entries };
      for (const e of next) entries[e.id] = e;
      return { entries, version: s.version + 1 };
    });
    schedulePersist();
  };
  const update = (id: string, patch: (e: VocabularyEntry) => VocabularyEntry) => {
    const current = get().entries[id];
    if (current) put([{ ...patch(current), modifiedAt: Date.now(), dirty: true }]);
  };

  return {
    entries: {},
    loaded: false,
    version: 0,

    load: async (appService) => {
      appServiceRef = appService;
      if (get().loaded) return;
      try {
        const list = await readVocabularyFile(appService);
        set((s) => {
          const entries = { ...s.entries };
          // Lookups recorded before the file finished loading win the merge.
          for (const e of list) entries[e.id] = entries[e.id] ? mergeEntries(e, entries[e.id]!) : e;
          return { entries, loaded: true, version: s.version + 1 };
        });
      } catch (err) {
        console.warn('[vocabulary] failed to load', err);
        set({ loaded: true });
      }
    },

    recordLookup: ({ word, lang, occurrence }) => {
      const key = normalizeWordKey(word);
      if (!key) return;
      const now = Date.now();
      const current = get().entries[entryId(lang, key)];
      const base = current && !current.deletedAt ? current : freshEntry(word, lang, key, now);
      put([{ ...(occurrence ? addOccurrence(base, occurrence) : base), dirty: true }]);
    },

    ensureEntry: (word, lang) => {
      const key = normalizeWordKey(word);
      const id = entryId(lang, key);
      const current = get().entries[id];
      if (!current || current.deletedAt) {
        put([{ ...freshEntry(word, lang, key, Date.now()), dirty: true }]);
      }
      return id;
    },

    setState: (id, state) => update(id, (e) => ({ ...e, state })),

    setHint: (id, hint) =>
      update(id, (e) => {
        const trimmed = hint.trim();
        const { hint: _old, ...rest } = e;
        return trimmed ? { ...rest, hint: trimmed } : rest;
      }),

    remove: (id) =>
      update(id, (e) => {
        const { hint: _hint, ...rest } = e;
        return { ...rest, state: 'none', occurrences: [], deletedAt: Date.now() };
      }),

    applyRemote: (remote) => {
      const { entries } = get();
      put(
        remote.map((r) => {
          const local = entries[r.id];
          if (!local) return r;
          const merged = mergeEntries(local, r);
          // Local changes the server hasn't seen yet still need a push.
          return local.dirty ? { ...merged, dirty: true } : merged;
        }),
      );
    },

    markPushed: (pushed) => {
      const { entries } = get();
      const clean = pushed
        .filter((p) => entries[p.id] === p)
        .map(({ dirty: _dirty, ...rest }) => rest);
      if (clean.length) put(clean);
    },

    getLearningAndMastered: (lang) => {
      const learning = new Map<string, string | undefined>();
      const mastered = new Set<string>();
      for (const e of Object.values(get().entries)) {
        if (e.lang !== lang || e.deletedAt) continue;
        if (e.state === 'learning') learning.set(e.key, e.hint);
        else if (e.state === 'mastered') mastered.add(e.key);
      }
      return { learning, mastered };
    },
  };
});
