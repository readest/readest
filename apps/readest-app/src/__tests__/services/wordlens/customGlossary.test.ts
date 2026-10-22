import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  collectCustomOccurrences,
  deleteWordLensGlossaryEntry,
  mergeGlossOccurrences,
  removeGlossaryEntry,
  resolveGlossaryEntries,
  saveWordLensGlossaryEntry,
  selectGlossaryEntries,
  upsertGlossaryEntry,
} from '@/services/wordlens/customGlossary';
import type { EnvConfigType } from '@/services/environment';
import type { GlossOccurrence } from '@/services/wordlens/types';
import type { WordLensGlossaryEntry } from '@/types/book';

const stores = vi.hoisted(() => ({
  getBookData: vi.fn(),
  getViewSettings: vi.fn(),
  setViewSettings: vi.fn(),
  getConfig: vi.fn(),
  saveConfig: vi.fn(),
  setSettings: vi.fn(),
  saveSettings: vi.fn(),
  settings: {
    globalViewSettings: { wordLensGlossary: [] as WordLensGlossaryEntry[] },
  },
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: {
    getState: () => ({
      getBookData: stores.getBookData,
      getConfig: stores.getConfig,
      saveConfig: stores.saveConfig,
    }),
  },
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: {
    getState: () => ({
      getViewSettings: stores.getViewSettings,
      setViewSettings: stores.setViewSettings,
    }),
  },
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      settings: stores.settings,
      setSettings: stores.setSettings,
      saveSettings: stores.saveSettings,
    }),
  },
}));

const entry = (
  overrides: Partial<WordLensGlossaryEntry> &
    Pick<WordLensGlossaryEntry, 'term' | 'definition' | 'scope'>,
): WordLensGlossaryEntry => ({
  id: overrides.id ?? overrides.term,
  ...overrides,
});

describe('selectGlossaryEntries', () => {
  const globalEntries: WordLensGlossaryEntry[] = [
    entry({ id: 'g', term: 'shard', definition: 'a fragment', scope: 'global' }),
    entry({
      id: 's',
      term: 'guild',
      definition: 'this series',
      scope: 'series',
      series: 'Mistborn',
    }),
    entry({
      id: 'other',
      term: 'guild',
      definition: 'other series',
      scope: 'series',
      series: 'Discworld',
    }),
    entry({
      id: 'b-global',
      term: 'coin',
      definition: 'from global book row',
      scope: 'book',
      bookHash: 'hash-a',
    }),
  ];
  const bookEntries: WordLensGlossaryEntry[] = [
    entry({ id: 'b', term: 'shard', definition: 'this book', scope: 'book', bookHash: 'hash-a' }),
    entry({
      id: 'other-book',
      term: 'coin',
      definition: 'other book',
      scope: 'book',
      bookHash: 'hash-b',
    }),
  ];

  it('keeps global entries, the matching series, and this book', () => {
    const selected = selectGlossaryEntries(globalEntries, bookEntries, 'hash-a', ' Mistborn ');
    const byTerm = Object.fromEntries(selected.map((item) => [item.term, item.definition]));
    expect(byTerm).toEqual({
      shard: 'this book',
      guild: 'this series',
      coin: 'from global book row',
    });
  });

  it('drops series entries when the book has no series name', () => {
    const selected = selectGlossaryEntries(globalEntries, [], 'hash-a', '  ');
    expect(selected.map((item) => item.term).sort()).toEqual(['coin', 'shard']);
  });

  it('ignores a book view-settings copy of the global list except real book rows', () => {
    const selected = selectGlossaryEntries(globalEntries, globalEntries, 'hash-a', 'Mistborn');
    expect(selected.find((item) => item.term === 'shard')?.scope).toBe('global');
  });
});

describe('collectCustomOccurrences', () => {
  it('matches a word and a phrase with the surface form and word boundaries', () => {
    const text = 'The Dark Brotherhood waits in Yorkshire.';
    const occurrences = collectCustomOccurrences(text, [
      entry({ term: 'york', definition: 'a city', scope: 'global' }),
      entry({ term: 'Dark Brotherhood', definition: 'a guild of assassins', scope: 'global' }),
    ]);
    expect(occurrences).toHaveLength(1);
    expect(text.slice(occurrences[0]!.start, occurrences[0]!.end)).toBe('Dark Brotherhood');
    expect(occurrences[0]).toMatchObject({
      word: 'Dark Brotherhood',
      gloss: 'a guild of assassins',
    });
  });

  it('lets a longer phrase claim its span and still match a later shorter word', () => {
    const text = 'the Dark Brotherhood and the Brotherhood';
    const occurrences = collectCustomOccurrences(text, [
      entry({ term: 'Brotherhood', definition: 'the order', scope: 'global' }),
      entry({ term: 'Dark Brotherhood', definition: 'the guild', scope: 'global' }),
    ]);
    expect(occurrences.map((item) => item.word)).toEqual(['Dark Brotherhood', 'Brotherhood']);
    expect(occurrences.map((item) => item.gloss)).toEqual(['the guild', 'the order']);
  });

  it('caps the inline hint and leaves the stored definition unchanged', () => {
    const stored = entry({
      term: 'relic',
      definition: 'a sacred object; kept whole, not split into senses',
      scope: 'global',
    });
    const original = stored.definition;
    const [occurrence] = collectCustomOccurrences('a relic here', [stored]);
    expect(original).toBe('a sacred object; kept whole, not split into senses');
    expect(occurrence?.gloss.endsWith('…')).toBe(true);
    expect(occurrence?.gloss).not.toBe(original);
    expect(occurrence?.gloss.includes(';')).toBe(true);
  });

  it('prefers a book definition over a global one for the same term', () => {
    const occurrences = collectCustomOccurrences('a shard', [
      entry({ term: 'shard', definition: 'global', scope: 'global' }),
      entry({ term: 'shard', definition: 'book', scope: 'book', bookHash: 'h' }),
    ]);
    expect(occurrences.map((item) => item.gloss)).toEqual(['book']);
  });
});

describe('mergeGlossOccurrences', () => {
  const pack: GlossOccurrence[] = [
    { start: 4, end: 15, word: 'Brotherhood', gloss: 'pack hint' },
    { start: 20, end: 24, word: 'coin', gloss: 'money' },
  ];

  it('replaces an overlapping pack span and keeps the rest', () => {
    const custom: GlossOccurrence[] = [
      { start: 0, end: 15, word: 'Dark Brotherhood', gloss: 'the guild' },
    ];
    expect(mergeGlossOccurrences(pack, custom)).toEqual([custom[0], pack[1]]);
  });

  it('returns the pack unchanged when there are no custom spans', () => {
    expect(mergeGlossOccurrences(pack, [])).toBe(pack);
  });
});

describe('glossary list edits', () => {
  const existing = [
    entry({ id: 'a', term: 'shard', definition: 'old', scope: 'global' }),
    entry({ id: 'b', term: 'coin', definition: 'money', scope: 'book', bookHash: 'h' }),
  ];

  it('updates the definition of the same term and scope', () => {
    const next = upsertGlossaryEntry(
      existing,
      entry({
        id: 'fresh',
        term: 'Shard',
        definition: 'new',
        scope: 'global',
      }),
    );
    expect(next).toHaveLength(2);
    expect(next[0]).toMatchObject({ id: 'a', definition: 'new', term: 'Shard' });
  });

  it('appends a new term', () => {
    const next = upsertGlossaryEntry(
      existing,
      entry({
        id: 'c',
        term: 'guild',
        definition: 'a group',
        scope: 'global',
      }),
    );
    expect(next.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('removes an entry by id', () => {
    expect(removeGlossaryEntry(existing, 'a').map((item) => item.id)).toEqual(['b']);
  });
});

describe('missing book', () => {
  const env = {} as EnvConfigType;

  beforeEach(() => {
    stores.getBookData.mockReset();
    stores.saveConfig.mockReset();
    stores.setSettings.mockReset();
    stores.setViewSettings.mockReset();
    stores.settings.globalViewSettings.wordLensGlossary = [];
    stores.getViewSettings.mockReturnValue({
      wordLensGlossary: [
        { id: 'b', term: 'coin', definition: 'money', scope: 'book', bookHash: 'hash-a' },
      ],
    });
    stores.getConfig.mockReturnValue({ bookHash: 'hash-a' });
  });

  it('does not save a book-scoped entry when the book is missing', async () => {
    for (const loaded of [null, { book: null }]) {
      stores.getBookData.mockReturnValue(loaded);
      const saved = await saveWordLensGlossaryEntry(env, 'hash-a-1', {
        term: 'coin',
        definition: 'money',
        scope: 'book',
      });
      expect(saved).toBe(false);
    }
    expect(stores.saveConfig).not.toHaveBeenCalled();
    expect(stores.setSettings).not.toHaveBeenCalled();
    expect(stores.setViewSettings).not.toHaveBeenCalled();
  });

  it('does not delete a book-scoped entry when the book is missing', async () => {
    stores.getBookData.mockReturnValue(null);
    await deleteWordLensGlossaryEntry(env, 'hash-a-1', 'b');
    expect(stores.saveConfig).not.toHaveBeenCalled();
    expect(stores.setViewSettings).not.toHaveBeenCalled();
  });
});

describe('resolveGlossaryEntries', () => {
  it('drops blank terms and definitions', () => {
    expect(
      resolveGlossaryEntries([
        entry({ term: '  ', definition: 'x', scope: 'global' }),
        entry({ term: 'ok', definition: '   ', scope: 'global' }),
      ]),
    ).toEqual([]);
  });
});
