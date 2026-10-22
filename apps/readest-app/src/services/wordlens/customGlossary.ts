// User glossary for Word Lens. Entries are matched against the section text
// and merged beside pack occurrences. They never go through planGlosses.

import type { EnvConfigType } from '@/services/environment';
import { cleanGloss } from '@/services/wordlens/gloss';
import type { GlossOccurrence } from '@/services/wordlens/types';
import type { WordLensGlossaryEntry, WordLensGlossaryScope } from '@/types/book';
import { eventDispatcher } from '@/utils/event';
import { uniqueId } from '@/utils/misc';

// Stores are loaded on save/delete only. A static import pulls Supabase in
// through the settings stack, and the section refresh only needs the matchers.

export const WORD_LENS_GLOSSARY_CHANGED = 'wordlens-glossary-changed';

export interface WordLensGlossaryDraft {
  id?: string;
  term: string;
  definition: string;
  scope: WordLensGlossaryScope;
}

const SCOPE_RANK: Record<WordLensGlossaryScope, number> = {
  global: 1,
  series: 2,
  book: 3,
};

// Same continuation class the planner's Latin tokenizer treats as one word,
// so a shorter entry does not match inside a longer token ("York" / "Yorkshire").
const WORD_CHAR = /[\p{L}\p{M}'’\-]/u;

const isWordCharAt = (text: string, index: number): boolean => {
  if (index < 0 || index >= text.length) return false;
  return WORD_CHAR.test(text[index]!);
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const termKey = (term: string): string => term.trim().toLowerCase();

const sameSlot = (a: WordLensGlossaryEntry, b: WordLensGlossaryEntry): boolean =>
  a.scope === b.scope &&
  termKey(a.term) === termKey(b.term) &&
  (a.scope !== 'book' || a.bookHash === b.bookHash) &&
  (a.scope !== 'series' || a.series === b.series);

/** Keep the most specific entry for each term. Book beats series beats global. */
export const resolveGlossaryEntries = (
  entries: WordLensGlossaryEntry[],
): WordLensGlossaryEntry[] => {
  const byTerm = new Map<string, WordLensGlossaryEntry>();
  for (const entry of entries) {
    const term = entry.term.trim();
    const definition = entry.definition.trim();
    if (!term || !definition) continue;
    const key = term.toLowerCase();
    const prev = byTerm.get(key);
    if (!prev || SCOPE_RANK[entry.scope] >= SCOPE_RANK[prev.scope]) {
      byTerm.set(key, { ...entry, term, definition });
    }
  }
  return [...byTerm.values()].sort(
    (a, b) => b.term.length - a.term.length || a.term.localeCompare(b.term),
  );
};

/**
 * Entries that apply to this book. Global and series rows are read from the
 * global list. Book rows are read from the book list, matched on `Book.hash`.
 * A book view-settings array that still holds a copy of the global list is
 * ignored except for its own book-scoped rows.
 */
export const selectGlossaryEntries = (
  globalEntries: WordLensGlossaryEntry[] | undefined,
  bookEntries: WordLensGlossaryEntry[] | undefined,
  bookHash: string,
  series: string | null | undefined,
): WordLensGlossaryEntry[] => {
  const seriesName = (series ?? '').trim();
  const fromGlobal = (globalEntries ?? []).filter((entry) => {
    if (entry.scope === 'global') return true;
    if (entry.scope === 'series') return !!seriesName && (entry.series ?? '').trim() === seriesName;
    if (entry.scope === 'book') return !!bookHash && entry.bookHash === bookHash;
    return false;
  });
  const fromBook = (bookEntries ?? []).filter(
    (entry) => entry.scope === 'book' && !!bookHash && entry.bookHash === bookHash,
  );
  return resolveGlossaryEntries([...fromGlobal, ...fromBook]);
};

/** Exact, case-insensitive matches, longest term first. Definitions are display-capped only. */
export const collectCustomOccurrences = (
  text: string,
  entries: WordLensGlossaryEntry[],
): GlossOccurrence[] => {
  if (!text || entries.length === 0) return [];
  const claimed: { start: number; end: number }[] = [];
  const occurrences: GlossOccurrence[] = [];
  for (const entry of resolveGlossaryEntries(entries)) {
    const gloss = cleanGloss(entry.definition, true);
    if (!gloss) continue;
    const re = new RegExp(escapeRegExp(entry.term), 'giu');
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      const start = match.index;
      const surface = match[0];
      if (!surface) break;
      const end = start + surface.length;
      if (isWordCharAt(text, start - 1) || isWordCharAt(text, end)) continue;
      if (claimed.some((span) => start < span.end && span.start < end)) continue;
      claimed.push({ start, end });
      occurrences.push({ start, end, word: surface, gloss });
    }
  }
  return occurrences;
};

/** Custom spans replace overlapping pack spans. Pack-only spans stay. */
export const mergeGlossOccurrences = (
  pack: GlossOccurrence[],
  custom: GlossOccurrence[],
): GlossOccurrence[] => {
  if (custom.length === 0) return pack;
  const overlaps = (a: GlossOccurrence, b: GlossOccurrence) => a.start < b.end && b.start < a.end;
  const kept = pack.filter(
    (occurrence) => !custom.some((customOcc) => overlaps(occurrence, customOcc)),
  );
  return [...kept, ...custom].sort((a, b) => a.start - b.start || b.end - a.end);
};

export const upsertGlossaryEntry = (
  entries: WordLensGlossaryEntry[],
  entry: WordLensGlossaryEntry,
): WordLensGlossaryEntry[] => {
  const index = entries.findIndex((existing) => sameSlot(existing, entry));
  if (index === -1) return [...entries, entry];
  const next = entries.slice();
  next[index] = { ...entries[index]!, ...entry, id: entries[index]!.id };
  return next;
};

export const removeGlossaryEntry = (
  entries: WordLensGlossaryEntry[],
  id: string,
): WordLensGlossaryEntry[] => entries.filter((entry) => entry.id !== id);

const stores = async () => {
  const [{ useBookDataStore }, { useReaderStore }, { useSettingsStore }] = await Promise.all([
    import('@/store/bookDataStore'),
    import('@/store/readerStore'),
    import('@/store/settingsStore'),
  ]);
  return { useBookDataStore, useReaderStore, useSettingsStore };
};

const bookIdentity = (
  bookKey: string,
  getBookData: (key: string) => { book?: { hash?: string; metadata?: { series?: string } } } | null,
): { hash: string; series: string } => {
  const book = getBookData(bookKey)?.book;
  return {
    hash: book?.hash || bookKey.split('-')[0] || '',
    series: book?.metadata?.series?.trim() || '',
  };
};

const writeGlobalEntries = async (
  envConfig: EnvConfigType,
  entries: WordLensGlossaryEntry[],
): Promise<void> => {
  const { useSettingsStore } = await stores();
  const { settings, setSettings, saveSettings } = useSettingsStore.getState();
  if (!settings.globalViewSettings) return;
  const updated = {
    ...settings,
    globalViewSettings: { ...settings.globalViewSettings, wordLensGlossary: entries },
  };
  setSettings(updated);
  await saveSettings(envConfig, updated);
};

const writeBookEntries = async (
  envConfig: EnvConfigType,
  bookKey: string,
  entries: WordLensGlossaryEntry[],
): Promise<void> => {
  const { useReaderStore, useBookDataStore, useSettingsStore } = await stores();
  const { getViewSettings, setViewSettings } = useReaderStore.getState();
  const { getConfig, saveConfig } = useBookDataStore.getState();
  const { settings } = useSettingsStore.getState();
  const viewSettings = getViewSettings(bookKey);
  if (!viewSettings) return;
  const updatedViewSettings = { ...viewSettings, wordLensGlossary: entries };
  setViewSettings(bookKey, updatedViewSettings);
  const config = getConfig(bookKey);
  if (config) {
    await saveConfig(
      envConfig,
      bookKey,
      { ...config, viewSettings: updatedViewSettings, updatedAt: Date.now() },
      settings,
    );
  }
};

const notifyGlossaryChanged = (bookKey?: string) => {
  void eventDispatcher.dispatch(WORD_LENS_GLOSSARY_CHANGED, bookKey ? { bookKey } : {});
};

export const saveWordLensGlossaryEntry = async (
  envConfig: EnvConfigType,
  bookKey: string,
  draft: WordLensGlossaryDraft,
): Promise<boolean> => {
  const term = draft.term.trim();
  const definition = draft.definition.trim();
  if (!term || !definition) return false;
  const { useBookDataStore, useReaderStore, useSettingsStore } = await stores();
  const book = useBookDataStore.getState().getBookData(bookKey)?.book ?? null;
  // A book-scoped row needs the open book. Do not invent a hash from bookKey.
  if (draft.scope === 'book' && !book) return false;
  const { hash, series } = book
    ? bookIdentity(bookKey, () => ({
        book: { hash: book.hash, metadata: { series: book.metadata?.series } },
      }))
    : { hash: '', series: '' };
  const readGlobalEntries = () =>
    useSettingsStore.getState().settings.globalViewSettings?.wordLensGlossary ?? [];
  const readBookEntries = () =>
    (useReaderStore.getState().getViewSettings(bookKey)?.wordLensGlossary ?? []).filter(
      (entry) => entry.scope === 'book' && entry.bookHash === hash,
    );

  if (draft.id) {
    const globalEntries = readGlobalEntries();
    if (globalEntries.some((entry) => entry.id === draft.id)) {
      await writeGlobalEntries(
        envConfig,
        globalEntries.map((entry) =>
          entry.id === draft.id ? { ...entry, term, definition } : entry,
        ),
      );
      notifyGlossaryChanged();
      return true;
    }
    const bookEntries = readBookEntries();
    if (bookEntries.some((entry) => entry.id === draft.id)) {
      await writeBookEntries(
        envConfig,
        bookKey,
        bookEntries.map((entry) =>
          entry.id === draft.id ? { ...entry, term, definition } : entry,
        ),
      );
      notifyGlossaryChanged(bookKey);
      return true;
    }
    return false;
  }

  if (draft.scope === 'book' && !hash) return false;
  if (draft.scope === 'series' && !series) return false;

  const entry: WordLensGlossaryEntry = {
    id: uniqueId(),
    term,
    definition,
    scope: draft.scope,
    ...(draft.scope === 'book' ? { bookHash: hash } : {}),
    ...(draft.scope === 'series' ? { series } : {}),
  };
  if (draft.scope === 'book') {
    await writeBookEntries(envConfig, bookKey, upsertGlossaryEntry(readBookEntries(), entry));
    notifyGlossaryChanged(bookKey);
  } else {
    await writeGlobalEntries(envConfig, upsertGlossaryEntry(readGlobalEntries(), entry));
    notifyGlossaryChanged();
  }
  return true;
};

export const deleteWordLensGlossaryEntry = async (
  envConfig: EnvConfigType,
  bookKey: string,
  id: string,
): Promise<void> => {
  const { useBookDataStore, useReaderStore, useSettingsStore } = await stores();
  const book = useBookDataStore.getState().getBookData(bookKey)?.book ?? null;
  const globalEntries =
    useSettingsStore.getState().settings.globalViewSettings?.wordLensGlossary ?? [];
  if (globalEntries.some((entry) => entry.id === id)) {
    await writeGlobalEntries(envConfig, removeGlossaryEntry(globalEntries, id));
    notifyGlossaryChanged();
    return;
  }
  if (!book) return;
  const { hash } = bookIdentity(bookKey, () => ({
    book: { hash: book.hash, metadata: { series: book.metadata?.series } },
  }));
  const bookEntries = (
    useReaderStore.getState().getViewSettings(bookKey)?.wordLensGlossary ?? []
  ).filter((entry) => entry.scope === 'book' && entry.bookHash === hash);
  if (!bookEntries.some((entry) => entry.id === id)) return;
  await writeBookEntries(envConfig, bookKey, removeGlossaryEntry(bookEntries, id));
  notifyGlossaryChanged(bookKey);
};
