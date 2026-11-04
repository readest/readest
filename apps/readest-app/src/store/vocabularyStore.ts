import { create } from 'zustand';
import type { AppService } from '@/types/system';
import type {
  VocabularyEntry,
  VocabularyImport,
  VocabularyOccurrence,
  VocabularyState,
} from '@/services/vocabulary/types';
import {
  addOccurrence,
  entryId,
  mergeEntries,
  normalizeWordKey,
} from '@/services/vocabulary/entry';
import {
  VOCABULARY_FILENAME,
  readVocabularyFile,
  writeVocabularyFile,
} from '@/services/vocabulary/persistence';

const PERSIST_DELAY_MS = 500;

interface VocabularyStore {
  entries: Record<string, VocabularyEntry>;
  loaded: boolean;
  /**
   * Words the data file held at load (0 when missing or unreadable). Sync
   * ignores its saved cursor then, so the server can rebuild the list.
   */
  loadedCount: number;
  /** Bumped on every change, so Word Lens can re-render on it. */
  version: number;
  load(appService: AppService): Promise<void>;
  /** Save a dictionary lookup. Never moves modifiedAt of a live entry. */
  recordLookup(input: { word: string; lang: string; occurrence?: VocabularyOccurrence }): void;
  /** The entry id for a word, creating an empty live entry if needed; '' for no letters. */
  ensureEntry(word: string, lang: string): string;
  setState(id: string, state: VocabularyState): void;
  setHint(id: string, hint: string): void;
  remove(id: string): void;
  /** Create or update many words in one change, as edits (they sync). */
  importWords(items: VocabularyImport[]): void;
  /** Merge entries pulled from the server; the result isn't pushed back. */
  applyRemote(entries: VocabularyEntry[]): void;
  /** Write the list to the data file now instead of after the save delay. */
  flush(): Promise<void>;
  /** Clear `dirty` on entries unchanged since this snapshot was pushed. */
  markPushed(pushed: VocabularyEntry[]): void;
  getLearningAndMastered(lang: string): {
    learning: Map<string, string | undefined>;
    mastered: Set<string>;
  };
}

const STATE_RANK: Record<VocabularyState, number> = { none: 0, learning: 1, mastered: 2 };

let appServiceRef: AppService | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

// Writes run one at a time, each saving the list as it is when it starts, so
// a slow earlier write can never land over a newer one. Nothing is written
// until the file has been loaded: the list in memory would be partial.
let writeChain: Promise<void> = Promise.resolve();
const saveNow = (): Promise<void> => {
  const run = writeChain.then(() => {
    if (!appServiceRef || !useVocabularyStore.getState().loaded) return;
    return writeVocabularyFile(appServiceRef, Object.values(useVocabularyStore.getState().entries));
  });
  writeChain = run.catch(() => {});
  return run;
};

const schedulePersist = () => {
  if (!appServiceRef) return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    saveNow().catch((err) => console.warn('[vocabulary] failed to save', err));
  }, PERSIST_DELAY_MS);
};

// modifiedAt 0: an entry made by a lookup carries no edit, so it must never
// outrank a Learning / Mastered mark or hint set on another device. Explicit
// edits stamp the current time.
// Copy an unreadable data file aside before the next save replaces it.
const keepUnreadableCopy = async (appService: AppService) => {
  try {
    const raw = await appService.readFile(VOCABULARY_FILENAME, 'Data', 'text');
    await appService.writeFile(`${VOCABULARY_FILENAME}.bak`, 'Data', raw as string);
  } catch (err) {
    console.warn('[vocabulary] could not keep a copy of the data file', err);
  }
};

const freshEntry = (word: string, lang: string, key: string, now: number): VocabularyEntry => ({
  id: entryId(lang, key),
  lang,
  key,
  word: word.trim(),
  state: 'none',
  occurrences: [],
  createdAt: now,
  modifiedAt: 0,
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
    loadedCount: 0,
    version: 0,

    load: async (appService) => {
      appServiceRef = appService;
      if (get().loaded) return;
      let list: VocabularyEntry[] = [];
      try {
        list = await readVocabularyFile(appService);
      } catch (err) {
        console.warn('[vocabulary] unreadable data file, keeping a copy', err);
        await keepUnreadableCopy(appService);
      }
      // Saves made before the file loaded were skipped; save the merged list.
      const unsaved = Object.keys(get().entries).length > 0;
      set((s) => {
        const entries = { ...s.entries };
        // Lookups recorded before the file finished loading win the merge, and
        // a change still waiting to be pushed on either side stays pending.
        for (const e of list) {
          const cur = entries[e.id];
          if (!cur) entries[e.id] = e;
          else if (e.dirty || cur.dirty) entries[e.id] = { ...mergeEntries(e, cur), dirty: true };
          else entries[e.id] = mergeEntries(e, cur);
        }
        return { entries, loaded: true, loadedCount: list.length, version: s.version + 1 };
      });
      if (unsaved) schedulePersist();
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
      if (!key) return '';
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

    importWords: (items) => {
      const now = Date.now();
      const next: VocabularyEntry[] = [];
      for (const { word, lang, state, hint } of items) {
        const key = normalizeWordKey(word);
        if (!key) continue;
        const current = get().entries[entryId(lang, key)];
        const base = current && !current.deletedAt ? current : freshEntry(word, lang, key, now);
        // Imports only move a word up: a plan made before the word moved up
        // (Sync and an import running together) must not undo it.
        const raise = state && STATE_RANK[state] > STATE_RANK[base.state];
        next.push({
          ...base,
          ...(raise ? { state } : {}),
          ...(hint ? { hint } : {}),
          modifiedAt: now,
          dirty: true,
        });
      }
      if (next.length) put(next);
    },

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

    flush: () => {
      if (persistTimer) clearTimeout(persistTimer);
      persistTimer = null;
      return saveNow();
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
