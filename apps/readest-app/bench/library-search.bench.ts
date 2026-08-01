import { readFileSync } from 'node:fs';
import { avg, type Bench, type BenchResult } from './lib.ts';
import { findContainsMatches } from '../src/utils/containsSearch.ts';
import { findFuzzyMatches } from '../src/utils/fuzzySearch.ts';
import { findNearbyMatches, segmentNearbyWords } from '../src/utils/nearbySearch.ts';

type Corpus = string[][];
type Source = 'en' | 'zh' | 'mixed';

const SECTION_CHARS = 30_000;
const SECTIONS_PER_BOOK = 10;
const EN_TEXT = readFileSync(new URL('./fixtures/alice.txt', import.meta.url), 'utf8');
const ZH_TEXT = readFileSync(new URL('./fixtures/hongloumeng.txt', import.meta.url), 'utf8');
const OFFSET_STRIDE = 9973;

// Slices of a fixture share the parent string (V8 SlicedString), so even the
// 1000-book corpus costs ~600 KB of real memory while every section stays
// genuine prose — English with natural word frequencies and punctuation,
// Chinese (unsegmented CJK) exercising the no-word-boundary path.
const sectionAt = (text: string, globalIndex: number, sectionChars: number) => {
  const start = (globalIndex * OFFSET_STRIDE) % (text.length - sectionChars);
  return text.slice(start, start + sectionChars);
};

const bookText = (source: Source, bookIndex: number) =>
  source === 'mixed'
    ? bookIndex % 2 === 0
      ? EN_TEXT
      : ZH_TEXT
    : source === 'zh'
      ? ZH_TEXT
      : EN_TEXT;

const makeCorpus = (
  bookCount: number,
  sectionsPerBook = SECTIONS_PER_BOOK,
  sectionChars = SECTION_CHARS,
  source: Source = 'en',
): Corpus =>
  Array.from({ length: bookCount }, (_, bookIndex) =>
    Array.from({ length: sectionsPerBook }, (_, sectionIndex) =>
      sectionAt(
        bookText(source, bookIndex),
        bookIndex * sectionsPerBook + sectionIndex,
        sectionChars,
      ),
    ),
  );

const totalChars = (corpus: Corpus) =>
  corpus.reduce(
    (bookTotal, sections) =>
      bookTotal + sections.reduce((sectionTotal, section) => sectionTotal + section.length, 0),
    0,
  );

const scanContains = (corpus: Corpus, query: string, stopAfter = Infinity) => {
  let matchCount = 0;
  for (const sections of corpus) {
    for (const section of sections) {
      for (const _match of findContainsMatches(
        section,
        query,
        {
          matchCase: false,
          matchDiacritics: false,
        },
        'en',
      )) {
        matchCount++;
        if (matchCount >= stopAfter) return matchCount;
      }
    }
  }
  return matchCount;
};

const scanFuzzy = (corpus: Corpus, query: string) => {
  let matchCount = 0;
  for (const sections of corpus) {
    for (const section of sections) {
      matchCount += findFuzzyMatches(section, query, {
        matchCase: false,
        matchDiacritics: false,
      }).length;
    }
  }
  return matchCount;
};

const nearbyOptions = (locale: string) => ({
  locale,
  matchCase: false,
  matchDiacritics: false,
  nearbyWords: 5,
});

const prepareNearby = (corpus: Corpus, locale: string) =>
  corpus.map((sections) => sections.map((text) => segmentNearbyWords(text, locale)));

const scanNearby = (
  corpus: Corpus,
  query: string,
  locale: string,
  prepared?: ReturnType<typeof prepareNearby>,
) => {
  let matchCount = 0;
  for (const [bookIndex, sections] of corpus.entries()) {
    for (const [sectionIndex, text] of sections.entries()) {
      matchCount += findNearbyMatches(
        text,
        query,
        nearbyOptions(locale),
        prepared?.[bookIndex]?.[sectionIndex],
      ).length;
    }
  }
  return matchCount;
};

const assertCount = (actual: number, expected: number, scenario: string) => {
  if (actual !== expected) {
    throw new Error(`${scenario}: expected ${expected} matches, received ${actual}`);
  }
};

export default {
  name: 'library-search',
  description: 'Sequential production-matcher scans for scoped library full-text search.',

  async run(): Promise<BenchResult[]> {
    const shelf = makeCorpus(10);
    const zhShelf = makeCorpus(10, SECTIONS_PER_BOOK, SECTION_CHARS, 'zh');
    const library100 = makeCorpus(100, SECTIONS_PER_BOOK, SECTION_CHARS, 'mixed');
    const library = makeCorpus(1000, SECTIONS_PER_BOOK, SECTION_CHARS, 'mixed');
    const earlyHit = makeCorpus(1000, SECTIONS_PER_BOOK, SECTION_CHARS, 'mixed');
    earlyHit[0]![0] = `libraryneedle ${earlyHit[0]![0]}`;
    const fuzzyShelf = makeCorpus(10, 2, 5_000).map((sections, bookIndex) =>
      sections.map((section, sectionIndex) =>
        bookIndex === 0 && sectionIndex === 0 ? `SearchableController ${section}` : section,
      ),
    );
    const zhFuzzyShelf = makeCorpus(10, 2, 5_000, 'zh');
    const nearbyShelf = makeCorpus(10, 2, 5_000);
    const zhNearbyShelf = makeCorpus(10, 2, 5_000, 'zh');
    const preparedNearbyShelf = prepareNearby(nearbyShelf, 'en');

    // Reference counts computed once outside timing; the fixtures are real
    // prose, so expectations are pinned by measurement rather than
    // hand-counted. Chinese scenarios use real terms from the corpus
    // (红楼梦): 宝玉/黛玉 (frequent), 林黛玉 (fuzzy target), 龘 (absent).
    const expectedFuzzy = scanFuzzy(fuzzyShelf, 'SearchableContrller');
    const expectedZhFuzzy = scanFuzzy(zhFuzzyShelf, '林黛玉');
    const expectedNearby = scanNearby(nearbyShelf, 'white rabbit', 'en');
    const expectedZhNearby = scanNearby(zhNearbyShelf, '宝玉 黛玉', 'zh');
    const expectedZhAbsent = scanContains(zhShelf, '龘龘');
    if (expectedFuzzy < 1) throw new Error('fuzzy fixture lost its injected match');
    if (expectedNearby < 1) throw new Error('nearby fixture has no co-occurring query words');
    if (expectedZhNearby < 1) throw new Error('zh nearby fixture has no co-occurring query words');
    if (expectedZhAbsent !== 0) throw new Error('zh absent term is present in fixture');

    let shelfMatches = -1;
    let zhShelfMatches = -1;
    let library100Matches = -1;
    let libraryMatches = -1;
    let firstResultMatches = -1;
    let cappedCommonMatches = -1;
    let cappedZhCommonMatches = -1;
    let fuzzyMatches = -1;
    let zhFuzzyMatches = -1;
    let cappedFuzzyMatches = -1;
    let coldNearbyMatches = -1;
    let warmNearbyMatches = -1;
    let zhNearbyMatches = -1;
    const shelfMs = await avg(
      async () => {
        shelfMatches = scanContains(shelf, 'zzql-term-not-present');
      },
      3,
      1,
    );
    const zhShelfMs = await avg(
      async () => {
        zhShelfMatches = scanContains(zhShelf, '龘龘');
      },
      3,
      1,
    );
    const library100Ms = await avg(
      async () => {
        library100Matches = scanContains(library100, 'zzql-term-not-present');
      },
      2,
      1,
    );
    const libraryMs = await avg(
      async () => {
        libraryMatches = scanContains(library, 'zzql-term-not-present');
      },
      1,
      0,
    );
    const firstResultMs = await avg(
      async () => {
        firstResultMatches = scanContains(earlyHit, 'libraryneedle', 1);
      },
      20,
      3,
    );
    const cappedCommonMs = await avg(
      async () => {
        cappedCommonMatches = scanContains(library, 'the', 500);
      },
      20,
      3,
    );
    const cappedZhCommonMs = await avg(
      async () => {
        cappedZhCommonMatches = scanContains(library, '宝玉', 500);
      },
      20,
      3,
    );
    const fuzzyMs = await avg(
      async () => {
        fuzzyMatches = scanFuzzy(fuzzyShelf, 'SearchableContrller');
      },
      2,
      1,
    );
    const zhFuzzyMs = await avg(
      async () => {
        zhFuzzyMatches = scanFuzzy(zhFuzzyShelf, '林黛玉');
      },
      2,
      1,
    );
    const cappedFuzzyMs = await avg(
      async () => {
        cappedFuzzyMatches = findFuzzyMatches(
          'a'.repeat(100_000),
          'aaa',
          { matchCase: false, matchDiacritics: false },
          500,
        ).length;
      },
      3,
      1,
    );
    const coldNearbyMs = await avg(
      async () => {
        coldNearbyMatches = scanNearby(nearbyShelf, 'white rabbit', 'en');
      },
      3,
      1,
    );
    const warmNearbyMs = await avg(
      async () => {
        warmNearbyMatches = scanNearby(nearbyShelf, 'white rabbit', 'en', preparedNearbyShelf);
      },
      3,
      1,
    );
    const zhNearbyMs = await avg(
      async () => {
        zhNearbyMatches = scanNearby(zhNearbyShelf, '宝玉 黛玉', 'zh');
      },
      3,
      1,
    );

    assertCount(shelfMatches, 0, 'current shelf absent query');
    assertCount(zhShelfMatches, 0, 'zh shelf absent query');
    assertCount(library100Matches, 0, '100-book library absent query');
    assertCount(libraryMatches, 0, 'whole library absent query');
    assertCount(firstResultMatches, 1, 'first streamed result');
    assertCount(cappedCommonMatches, 500, 'capped common-word query');
    assertCount(cappedZhCommonMatches, 500, 'capped common zh query');
    assertCount(fuzzyMatches, expectedFuzzy, 'current shelf fuzzy query');
    assertCount(zhFuzzyMatches, expectedZhFuzzy, 'zh shelf fuzzy query');
    assertCount(cappedFuzzyMatches, 500, 'capped single-character fuzzy query');
    assertCount(coldNearbyMatches, expectedNearby, 'current shelf cold nearby query');
    assertCount(warmNearbyMatches, expectedNearby, 'current shelf warm nearby query');
    assertCount(zhNearbyMatches, expectedZhNearby, 'zh shelf nearby query');

    return [
      {
        scenario: '10-book shelf, absent contains query',
        unit: 'ms',
        value: shelfMs,
        meta: {
          books: shelf.length,
          sections: shelf.length * SECTIONS_PER_BOOK,
          chars: totalChars(shelf),
        },
      },
      {
        scenario: '10-book zh shelf, absent contains query',
        unit: 'ms',
        value: zhShelfMs,
        meta: {
          books: zhShelf.length,
          sections: zhShelf.length * SECTIONS_PER_BOOK,
          chars: totalChars(zhShelf),
        },
      },
      {
        scenario: '100-book mixed en/zh library, absent contains query',
        unit: 'ms',
        value: library100Ms,
        meta: {
          books: library100.length,
          sections: library100.length * SECTIONS_PER_BOOK,
          chars: totalChars(library100),
          mix: 'en 50% / zh 50%',
        },
      },
      {
        scenario: '1000-book mixed en/zh library, absent contains query',
        unit: 'ms',
        value: libraryMs,
        meta: {
          books: library.length,
          sections: library.length * SECTIONS_PER_BOOK,
          chars: totalChars(library),
          mix: 'en 50% / zh 50%',
        },
      },
      {
        scenario: '1000-book mixed library, first streamed result',
        unit: 'ms',
        value: firstResultMs,
        meta: {
          books: earlyHit.length,
          firstSectionChars: earlyHit[0]![0]!.length,
          matches: 1,
        },
      },
      {
        scenario: '1000-book mixed library, common en word capped at 500',
        unit: 'ms',
        value: cappedCommonMs,
        meta: {
          books: library.length,
          chars: totalChars(library),
          limit: 500,
          matches: cappedCommonMatches,
        },
      },
      {
        scenario: '1000-book mixed library, common zh term capped at 500',
        unit: 'ms',
        value: cappedZhCommonMs,
        meta: {
          books: library.length,
          chars: totalChars(library),
          limit: 500,
          matches: cappedZhCommonMatches,
        },
      },
      {
        scenario: '10-book shelf, fuzzy query',
        unit: 'ms',
        value: fuzzyMs,
        meta: {
          books: fuzzyShelf.length,
          sections: fuzzyShelf.reduce((sum, sections) => sum + sections.length, 0),
          chars: totalChars(fuzzyShelf),
          matches: fuzzyMatches,
        },
      },
      {
        scenario: '10-book zh shelf, fuzzy query',
        unit: 'ms',
        value: zhFuzzyMs,
        meta: {
          books: zhFuzzyShelf.length,
          sections: zhFuzzyShelf.reduce((sum, sections) => sum + sections.length, 0),
          chars: totalChars(zhFuzzyShelf),
          matches: zhFuzzyMatches,
        },
      },
      {
        scenario: '100k repeated chars, capped fuzzy query',
        unit: 'ms',
        value: cappedFuzzyMs,
        meta: {
          chars: 100_000,
          limit: 500,
          matches: cappedFuzzyMatches,
        },
      },
      {
        scenario: '10-book shelf, cold nearby query',
        unit: 'ms',
        value: coldNearbyMs,
        meta: {
          books: nearbyShelf.length,
          sections: nearbyShelf.reduce((sum, sections) => sum + sections.length, 0),
          chars: totalChars(nearbyShelf),
          matches: coldNearbyMatches,
        },
      },
      {
        scenario: '10-book shelf, pre-segmented nearby matcher',
        unit: 'ms',
        value: warmNearbyMs,
        meta: {
          books: nearbyShelf.length,
          sections: nearbyShelf.reduce((sum, sections) => sum + sections.length, 0),
          chars: totalChars(nearbyShelf),
          matches: warmNearbyMatches,
        },
      },
      {
        scenario: '10-book zh shelf, cold nearby query',
        unit: 'ms',
        value: zhNearbyMs,
        meta: {
          books: zhNearbyShelf.length,
          sections: zhNearbyShelf.reduce((sum, sections) => sum + sections.length, 0),
          chars: totalChars(zhNearbyShelf),
          matches: zhNearbyMatches,
        },
      },
    ];
  },
} satisfies Bench;
