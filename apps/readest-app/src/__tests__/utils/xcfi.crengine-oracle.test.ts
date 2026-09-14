// Validates Readest's CFI <-> XPointer conversion against XPointers produced
// by the real crengine (KOReader's engine), captured with
// apps/readest.koplugin/scripts/xpointer-oracle.lua.
//
// Every fixture under src/__tests__/fixtures/crengine/ lists, for each spine
// item, crengine's XPointer pair and text for a sample of visible words. Both
// sync directions are checked for every word:
//   KOReader -> Readest: xPointerToCFI(xp, xp_end) must land on exactly that word
//   Readest -> KOReader: a CFI built on that word must convert back to exactly
//                        crengine's xp / xp_end
//
// Ad hoc validation of any local EPUB (not committed, e.g. a reporter's book):
//   XPOINTER_ORACLE=/path/to/book.crengine.json pnpm test src/__tests__/utils/xcfi.crengine-oracle.test.ts
// where the JSON's `epub` field is an absolute path or lives next to the JSON.
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { dirname, isAbsolute, join, resolve } from 'path';
import * as CFI from 'foliate-js/epubcfi.js';
import { DocumentLoader } from '@/libs/document';
import type { BookDoc } from '@/libs/document';
import { XCFI } from '@/utils/xcfi';

type OracleWord = { xp: string; xp_end: string; text: string };
type Oracle = {
  epub: string;
  fragments: { index: number; docfragment: number; word_count: number; words: OracleWord[] }[];
};

const FIXTURES = resolve(__dirname, '../fixtures/crengine');
const DATA = resolve(__dirname, '../fixtures/data');

const oracles = (): { name: string; oracle: Oracle; epub: string }[] => {
  const override = process.env['XPOINTER_ORACLE'];
  const files = override
    ? [override]
    : readdirSync(FIXTURES)
        .filter((f) => f.endsWith('.json'))
        .map((f) => join(FIXTURES, f));
  return files.map((file) => {
    const oracle = JSON.parse(readFileSync(file, 'utf8')) as Oracle;
    const candidates = isAbsolute(oracle.epub)
      ? [oracle.epub]
      : [join(dirname(file), oracle.epub), join(DATA, oracle.epub)];
    const epub = candidates.find((p) => existsSync(p));
    if (!epub) throw new Error(`EPUB for ${file} not found: ${candidates.join(', ')}`);
    return { name: oracle.epub, oracle, epub };
  });
};

const openBook = async (file: string): Promise<BookDoc> => {
  const buffer = readFileSync(file);
  const f = new File([buffer], file.split('/').pop()!, { type: 'application/epub+zip' });
  const { book } = await new DocumentLoader(f).open();
  return book;
};

// crengine writes /body/DocFragment/... (no index) when the book has a single
// spine item; it resolves the indexed form too, and Readest always emits it.
const indexed = (xp: string) => xp.replace(/^\/body\/DocFragment\//, '/body/DocFragment[1]/');

const cases = oracles();

describe.each(cases)('crengine XPointer oracle: $name', ({ oracle, epub }) => {
  it('converts every sampled word both ways exactly as crengine does', async () => {
    const book = await openBook(epub);
    expect(book.sections!.length).toBe(oracle.fragments.length);

    const pull: string[] = [];
    const push: string[] = [];
    let words = 0;
    for (const fragment of oracle.fragments) {
      const { index } = fragment;
      const section = book.sections![index]!;
      const doc = await section.createDocument();
      const converter = new XCFI(doc, index);
      const base = section.cfi ?? CFI.fake.fromIndex(index);

      for (const word of fragment.words) {
        words++;
        const xp = indexed(word.xp);
        const xpEnd = indexed(word.xp_end);

        // KOReader -> Readest: the range must cover exactly crengine's word.
        let range: Range | null = null;
        try {
          const cfi = converter.xPointerToCFI(xp, xpEnd);
          const anchored = book.resolveCFI!(cfi)?.anchor?.(doc);
          const got =
            !anchored || typeof anchored === 'number' ? '<unresolved>' : anchored.toString();
          if (got === word.text) range = anchored as Range;
          else pull.push(`${xp}: expected "${word.text}", got "${got}"`);
        } catch (e) {
          pull.push(`${xp}: ${String(e).split('\n')[0]}`);
        }
        if (!range) continue; // no trusted location to push from; reported above

        // Readest -> KOReader: a highlight on that range must come back as
        // crengine's own pointers.
        try {
          const cfi = CFI.joinIndir(base, CFI.fromRange(range));
          const back = converter.cfiToXPointer(cfi);
          if (back.pos0 !== xp || back.pos1 !== xpEnd) {
            push.push(
              `"${word.text}": expected ${xp} .. ${xpEnd}, got ${back.pos0} .. ${back.pos1}`,
            );
          }
        } catch (e) {
          push.push(`"${word.text}": ${String(e).split('\n')[0]}`);
        }
      }
    }

    const summarize = (label: string, list: string[]) =>
      `${label}: ${list.length}/${words} mismatches\n  ${list.slice(0, 10).join('\n  ')}`;
    // Report both directions in one run rather than stopping at the first.
    expect.soft(pull, summarize('KOReader -> Readest', pull)).toEqual([]);
    expect.soft(push, summarize('Readest -> KOReader', push)).toEqual([]);
  }, 120000);
});
