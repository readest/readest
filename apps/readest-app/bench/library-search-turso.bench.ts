import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { connect } from '@tursodatabase/database';
import { timed, type Bench, type BenchResult } from './lib.ts';
import { findContainsMatches } from '../src/utils/containsSearch.ts';

/**
 * Per-book Turso search-index benchmark for library full-text search.
 *
 * Layout under test: each book directory carries its own `search.db` (beside
 * cover.png) holding extracted section text, so search never has to open the
 * book file, unzip it, or parse section DOMs. Corpus is real prose, half
 * English (bench/fixtures/alice.txt) and half Chinese
 * (bench/fixtures/hongloumeng.txt) — CJK has no word boundaries, so it is the
 * acid test for tokenizer-dependent strategies. Measured:
 *
 *   1. build      — per-book DB create + section insert + Tantivy FTS index
 *                   (when supported): the one-time import/first-scan cost,
 *                   plus resulting on-disk size per book.
 *   2. fts_match  — per-book open → fts_match() → close, fanned out at
 *                   10/100/1000 books. Default tokenizer for the en query;
 *                   the zh query documents whether the default tokenizer can
 *                   match unsegmented CJK at all.
 *   3. ngram      — a zh-only DB set indexed WITH (tokenizer = 'ngram'), the
 *                   standard CJK approach: build cost, size, and match counts
 *                   vs the default tokenizer.
 *   4. LIKE       — substring semantics inside the engine (script-agnostic).
 *   5. text+JS    — read section text, run the production contains matcher
 *                   (exact production semantics; script-agnostic).
 *
 * Turso has no FTS5; its native FTS is Tantivy-based (`CREATE INDEX ... USING
 * fts`, `fts_match()`, needs `experimental: ['index_method']`) and has no
 * published large-corpus numbers — this bench exists to establish them. The
 * same engine ships in tauri-plugin-turso (native) and
 * @readest/turso-database-wasm (web), so Node numbers are representative of
 * native; expect wasm to be slower by a constant factor.
 */

const SECTION_CHARS = 30_000;
const SECTIONS_PER_BOOK = 10;
const BOOK_COUNT = 1000;
const FAN_OUT_SIZES = [10, 100, 1000];
const NGRAM_BOOK_COUNT = 30;
const EN_TEXT = readFileSync(new URL('./fixtures/alice.txt', import.meta.url), 'utf8');
const ZH_TEXT = readFileSync(new URL('./fixtures/hongloumeng.txt', import.meta.url), 'utf8');
const OFFSET_STRIDE = 9973;
const DB_ROOT = new URL('./tmp-library-search-turso/', import.meta.url).pathname;

const sectionAt = (text: string, globalIndex: number) => {
  const start = (globalIndex * OFFSET_STRIDE) % (text.length - SECTION_CHARS);
  return text.slice(start, start + SECTION_CHARS);
};

// Even book indexes are English, odd are Chinese (50/50 mixed library).
const bookSections = (bookIndex: number, text?: string) =>
  Array.from({ length: SECTIONS_PER_BOOK }, (_, sectionIndex) =>
    sectionAt(
      text ?? (bookIndex % 2 === 0 ? EN_TEXT : ZH_TEXT),
      bookIndex * SECTIONS_PER_BOOK + sectionIndex,
    ),
  );

const bookDir = (set: string, bookIndex: number) => `${DB_ROOT}${set}/book-${bookIndex}`;

const openBookDb = (set: string, bookIndex: number) =>
  connect(`${bookDir(set, bookIndex)}/search.db`, { experimental: ['index_method'] });

const buildBookDb = async (
  set: string,
  bookIndex: number,
  ftsClause: string | null,
  text?: string,
) => {
  mkdirSync(bookDir(set, bookIndex), { recursive: true });
  const db = await openBookDb(set, bookIndex);
  await db.exec('CREATE TABLE sections (idx INTEGER PRIMARY KEY, text TEXT NOT NULL)');
  await db.exec('BEGIN');
  const insert = await db.prepare('INSERT INTO sections (idx, text) VALUES (?, ?)');
  for (const [sectionIndex, sectionText] of bookSections(bookIndex, text).entries()) {
    await insert.run(sectionIndex, sectionText);
  }
  await db.exec('COMMIT');
  // ftsClause '' = default tokenizer; null = no index. An earlier version
  // used `if (ftsClause)` here — the falsy empty string silently skipped
  // index creation and made fts_match run its no-index per-row fallback,
  // which read as "the index doesn't help". Guard against null explicitly.
  if (ftsClause !== null) {
    await db.exec(`CREATE INDEX idx_sections_fts ON sections USING fts (text)${ftsClause}`);
  }
  await db.close();
};

const dirBytes = (path: string): number =>
  readdirSync(path, { withFileTypes: true }).reduce((sum, entry) => {
    const child = `${path}/${entry.name}`;
    return sum + (entry.isDirectory() ? dirBytes(child) : statSync(child).size);
  }, 0);

const avgBookBytes = (set: string, count: number) => {
  let total = 0;
  for (let bookIndex = 0; bookIndex < count; bookIndex++)
    total += dirBytes(bookDir(set, bookIndex));
  return Math.round(total / count);
};

const probeFtsSupport = async () => {
  mkdirSync(`${DB_ROOT}probe`, { recursive: true });
  const db = await connect(`${DB_ROOT}probe/probe.db`, { experimental: ['index_method'] });
  try {
    await db.exec('CREATE TABLE p (t TEXT)');
    await db.exec('CREATE INDEX p_fts ON p USING fts (t)');
    return true;
  } catch {
    return false;
  } finally {
    await db.close();
  }
};

type PerBookQuery = (db: Awaited<ReturnType<typeof openBookDb>>) => Promise<number>;

const fanOut = async (set: string, books: number, query: PerBookQuery) => {
  let matches = 0;
  for (let bookIndex = 0; bookIndex < books; bookIndex++) {
    const db = await openBookDb(set, bookIndex);
    try {
      matches += await query(db);
    } finally {
      await db.close();
    }
  }
  return matches;
};

const ftsQuery =
  (term: string): PerBookQuery =>
  async (db) => {
    const stmt = await db.prepare('SELECT idx FROM sections WHERE fts_match(text, ?)');
    const rows = await stmt.all(term);
    return rows.length;
  };

const likeQuery =
  (term: string): PerBookQuery =>
  async (db) => {
    const stmt = await db.prepare('SELECT idx FROM sections WHERE text LIKE ?');
    const rows = await stmt.all(`%${term}%`);
    return rows.length;
  };

const jsMatcherQuery =
  (term: string): PerBookQuery =>
  async (db) => {
    const stmt = await db.prepare('SELECT idx, text FROM sections ORDER BY idx');
    const rows = (await stmt.all()) as Array<{ idx: number; text: string }>;
    let count = 0;
    for (const row of rows) {
      for (const _match of findContainsMatches(
        row.text,
        term,
        { matchCase: false, matchDiacritics: false },
        'en',
      )) {
        count++;
      }
    }
    return count;
  };

export default {
  name: 'library-search-turso',
  description: 'Per-book Turso search.db: build cost and query fan-out strategies.',

  async run(): Promise<BenchResult[]> {
    rmSync(DB_ROOT, { recursive: true, force: true });
    mkdirSync(DB_ROOT, { recursive: true });
    const results: BenchResult[] = [];

    try {
      const ftsSupported = await probeFtsSupport();
      const ftsClause = ftsSupported ? '' : null;

      const { ms: buildMs } = await timed(async () => {
        for (let bookIndex = 0; bookIndex < BOOK_COUNT; bookIndex++) {
          await buildBookDb('main', bookIndex, ftsClause);
        }
      });
      results.push({
        scenario: `build ${BOOK_COUNT} per-book DBs (${ftsSupported ? 'default fts' : 'NO fts'})`,
        unit: 'ms',
        value: buildMs / BOOK_COUNT,
        meta: {
          books: BOOK_COUNT,
          charsPerBook: SECTION_CHARS * SECTIONS_PER_BOOK,
          totalMs: Math.round(buildMs),
          avgBookBytes: avgBookBytes('main', Math.min(BOOK_COUNT, 50)),
          mix: 'en 50% / zh 50%',
        },
      });

      const { ms: openMs } = await timed(async () => {
        await fanOut('main', 100, async () => 0);
      });
      results.push({
        scenario: 'open+close fan-out, no query',
        unit: 'ms',
        value: openMs / 100,
        meta: { books: 100, totalMs: Math.round(openMs) },
      });

      for (const books of FAN_OUT_SIZES) {
        if (!ftsSupported) break;
        const { result: matches, ms } = await timed(() =>
          fanOut('main', books, ftsQuery('zzqlterm')),
        );
        results.push({
          scenario: `fts_match ${books}-book fan-out, absent en term`,
          unit: 'ms',
          value: ms,
          meta: { books, matches, perBookMs: Number((ms / books).toFixed(3)) },
        });
      }

      if (ftsSupported) {
        const { result: ftsCommonEn, ms: ftsCommonEnMs } = await timed(() =>
          fanOut('main', BOOK_COUNT, ftsQuery('rabbit')),
        );
        results.push({
          scenario: `fts_match ${BOOK_COUNT}-book fan-out, common en word`,
          unit: 'ms',
          value: ftsCommonEnMs,
          meta: { books: BOOK_COUNT, matches: ftsCommonEn },
        });

        // Default tokenizer vs unsegmented CJK: match count is the finding.
        const { result: ftsZh, ms: ftsZhMs } = await timed(() =>
          fanOut('main', BOOK_COUNT, ftsQuery('宝玉')),
        );
        results.push({
          scenario: `fts_match ${BOOK_COUNT}-book fan-out, common zh term (default tokenizer)`,
          unit: 'ms',
          value: ftsZhMs,
          meta: { books: BOOK_COUNT, matches: ftsZh },
        });
      }

      const { result: likeZh, ms: likeZhMs } = await timed(() =>
        fanOut('main', BOOK_COUNT, likeQuery('宝玉')),
      );
      results.push({
        scenario: `LIKE ${BOOK_COUNT}-book fan-out, common zh term`,
        unit: 'ms',
        value: likeZhMs,
        meta: { books: BOOK_COUNT, matches: likeZh },
      });

      for (const books of FAN_OUT_SIZES) {
        const { result: matches, ms } = await timed(() =>
          fanOut('main', books, jsMatcherQuery('zzql-term-not-present')),
        );
        results.push({
          scenario: `cached text + JS contains ${books}-book fan-out, absent term`,
          unit: 'ms',
          value: ms,
          meta: { books, matches, perBookMs: Number((ms / books).toFixed(3)) },
        });
        if (matches !== 0) throw new Error('absent term produced matches');
      }

      if (ftsSupported) {
        let ngramBuilt = true;
        let ngramBuildMs = 0;
        try {
          const { ms } = await timed(async () => {
            for (let bookIndex = 0; bookIndex < NGRAM_BOOK_COUNT; bookIndex++) {
              await buildBookDb('ngram', bookIndex, " WITH (tokenizer = 'ngram')", ZH_TEXT);
            }
          });
          ngramBuildMs = ms;
        } catch {
          ngramBuilt = false;
        }
        if (ngramBuilt) {
          results.push({
            scenario: `build ${NGRAM_BOOK_COUNT} zh per-book DBs (ngram fts)`,
            unit: 'ms',
            value: ngramBuildMs / NGRAM_BOOK_COUNT,
            meta: {
              books: NGRAM_BOOK_COUNT,
              charsPerBook: SECTION_CHARS * SECTIONS_PER_BOOK,
              totalMs: Math.round(ngramBuildMs),
              avgBookBytes: avgBookBytes('ngram', NGRAM_BOOK_COUNT),
            },
          });

          const { result: ngramZh, ms: ngramZhMs } = await timed(() =>
            fanOut('ngram', NGRAM_BOOK_COUNT, ftsQuery('宝玉')),
          );
          results.push({
            scenario: `fts_match ${NGRAM_BOOK_COUNT}-book zh fan-out, common zh term (ngram tokenizer)`,
            unit: 'ms',
            value: ngramZhMs,
            meta: { books: NGRAM_BOOK_COUNT, matches: ngramZh },
          });

          const { result: ngramAbsent, ms: ngramAbsentMs } = await timed(() =>
            fanOut('ngram', NGRAM_BOOK_COUNT, ftsQuery('龘龘')),
          );
          results.push({
            scenario: `fts_match ${NGRAM_BOOK_COUNT}-book zh fan-out, absent zh term (ngram tokenizer)`,
            unit: 'ms',
            value: ngramAbsentMs,
            meta: { books: NGRAM_BOOK_COUNT, matches: ngramAbsent },
          });
        } else {
          results.push({
            scenario: 'ngram tokenizer unavailable',
            unit: 'ms',
            value: 0,
            meta: { books: 0 },
          });
        }
      }
    } finally {
      rmSync(DB_ROOT, { recursive: true, force: true });
    }

    return results;
  },
} satisfies Bench;
