import { avg, type Bench, type BenchResult } from './lib.ts';
import { findContainsMatches } from '../src/utils/containsSearch.ts';
import { findFuzzyMatches } from '../src/utils/fuzzySearch.ts';
import { findNearbyMatches, segmentNearbyWords } from '../src/utils/nearbySearch.ts';

type Corpus = string[][];

const SECTION_CHARS = 5_000;
const SECTIONS_PER_BOOK = 10;
const BASE_TEXT =
  'A quiet reader turns the page while morning light crosses the room. ' +
  'The archive keeps each chapter available for careful study and reference. ';

const makeCorpus = (bookCount: number, sectionsPerBook = SECTIONS_PER_BOOK): Corpus =>
  Array.from({ length: bookCount }, () =>
    Array.from({ length: sectionsPerBook }, () => BASE_TEXT.repeat(40).slice(0, SECTION_CHARS)),
  );

const totalChars = (corpus: Corpus) =>
  corpus.reduce(
    (bookTotal, sections) =>
      bookTotal + sections.reduce((sectionTotal, section) => sectionTotal + section.length, 0),
    0,
  );

const scanContains = (corpus: Corpus, query: string, stopAfterFirst = false) => {
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
        if (stopAfterFirst) return matchCount;
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

const nearbyOptions = {
  locale: 'en',
  matchCase: false,
  matchDiacritics: false,
  nearbyWords: 5,
};

const prepareNearby = (corpus: Corpus) =>
  corpus.map((sections) => sections.map((text) => segmentNearbyWords(text, nearbyOptions.locale)));

const scanNearby = (corpus: Corpus, query: string, prepared?: ReturnType<typeof prepareNearby>) => {
  let matchCount = 0;
  for (const [bookIndex, sections] of corpus.entries()) {
    for (const [sectionIndex, text] of sections.entries()) {
      matchCount += findNearbyMatches(
        text,
        query,
        nearbyOptions,
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
    const library = makeCorpus(100);
    const earlyHit = makeCorpus(100);
    earlyHit[0]![0] = `libraryneedle ${earlyHit[0]![0]}`;
    const fuzzyShelf = makeCorpus(10, 2).map((sections, bookIndex) =>
      sections.map((section, sectionIndex) =>
        bookIndex === 0 && sectionIndex === 0 ? `SearchableController ${section}` : section,
      ),
    );
    const nearbyShelf = makeCorpus(10, 2).map((sections) =>
      sections.map((section) => `alpha filler beta ${section}`),
    );
    const preparedNearbyShelf = prepareNearby(nearbyShelf);

    let shelfMatches = -1;
    let libraryMatches = -1;
    let firstResultMatches = -1;
    let fuzzyMatches = -1;
    let cappedFuzzyMatches = -1;
    let coldNearbyMatches = -1;
    let warmNearbyMatches = -1;
    const shelfMs = await avg(
      async () => {
        shelfMatches = scanContains(shelf, 'term-not-present');
      },
      3,
      1,
    );
    const libraryMs = await avg(
      async () => {
        libraryMatches = scanContains(library, 'term-not-present');
      },
      1,
      0,
    );
    const firstResultMs = await avg(
      async () => {
        firstResultMatches = scanContains(earlyHit, 'libraryneedle', true);
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
        coldNearbyMatches = scanNearby(nearbyShelf, 'alpha beta');
      },
      3,
      1,
    );
    const warmNearbyMs = await avg(
      async () => {
        warmNearbyMatches = scanNearby(nearbyShelf, 'alpha beta', preparedNearbyShelf);
      },
      3,
      1,
    );

    assertCount(shelfMatches, 0, 'current shelf absent query');
    assertCount(libraryMatches, 0, 'whole library absent query');
    assertCount(firstResultMatches, 1, 'first streamed result');
    assertCount(fuzzyMatches, 1, 'current shelf fuzzy query');
    assertCount(cappedFuzzyMatches, 500, 'capped single-character fuzzy query');
    assertCount(coldNearbyMatches, 20, 'current shelf cold nearby query');
    assertCount(warmNearbyMatches, 20, 'current shelf warm nearby query');

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
        scenario: '100-book library, absent contains query',
        unit: 'ms',
        value: libraryMs,
        meta: {
          books: library.length,
          sections: library.length * SECTIONS_PER_BOOK,
          chars: totalChars(library),
        },
      },
      {
        scenario: '100-book library, first streamed result',
        unit: 'ms',
        value: firstResultMs,
        meta: {
          books: earlyHit.length,
          firstSectionChars: earlyHit[0]![0]!.length,
          matches: 1,
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
          matches: 1,
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
    ];
  },
} satisfies Bench;
