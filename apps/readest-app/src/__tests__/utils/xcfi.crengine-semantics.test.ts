// XPointer semantics pinned against the real crengine (KOReader's engine),
// found with apps/readest.koplugin/scripts/xpointer-oracle.lua. See
// crengine/src/lvtinydom.cpp ldomXPointer::toString: a text step is
// `/text()[K]` with K counting the parent's TEXT children only, and the `[K]`
// is omitted when the parent has a single text child. The offset is within
// that text node, never cumulative over the element's descendants. Likewise
// `DocFragment[N]` loses its `[N]` when the book has a single spine item.
import { describe, expect, it } from 'vitest';
import * as CFI from 'foliate-js/epubcfi.js';
import { XCFI } from '@/utils/xcfi';

const html = (body: string) =>
  new DOMParser().parseFromString(`<html><body>${body}</body></html>`, 'text/html');

/** Text covered by a range CFI, resolved in `doc` like the reader does. */
const rangeText = (doc: Document, cfi: string) => {
  const parts = CFI.parse(cfi);
  (parts.parent ?? parts).shift(); // drop the spine step
  return CFI.toRange(doc, parts).toString();
};

describe('unindexed /text().N is the element’s only text child, offset N inside it', () => {
  // sample-alice.epub chapter headings: crengine emits h2/text().1 for the
  // "D" of "Down", i.e. offset 1 of the "\nDown the Rabbit Hole" text node.
  // Cumulative-over-descendants reading lands on "hapter" instead.
  const doc = html(
    '<h2><span class="chapterHeader"><span class="translation">Chapter</span> <span class="count">1</span></span>\nDown the Rabbit Hole</h2>',
  );
  const converter = new XCFI(doc, 3);

  it('resolves a KOReader range after inline children to the right word', () => {
    const cfi = converter.xPointerToCFI(
      '/body/DocFragment[4]/body/h2/text().1',
      '/body/DocFragment[4]/body/h2/text().5',
    );
    expect(rangeText(doc, cfi)).toBe('Down');
  });

  it('round-trips its own XPointer for a selection after an inline child', () => {
    const doc2 = html('<p><em>x</em> rest of it</p>');
    const c = new XCFI(doc2, 0);
    const node = doc2.querySelector('p')!.lastChild as Text; // " rest of it"
    const range = doc2.createRange();
    range.setStart(node, 1);
    range.setEnd(node, 5);
    const cfi = CFI.joinIndir(CFI.fake.fromIndex(0), CFI.fromRange(range));
    const xp = c.cfiToXPointer(cfi);
    expect(xp.pos0).toBe('/body/DocFragment[1]/body/p/text().1');
    expect(rangeText(doc2, c.xPointerToCFI(xp.pos0!, xp.pos1!))).toBe('rest');
  });

  it('skips the whitespace-only text node crengine drops at the start of a block', () => {
    // crengine parses "<p>\n<em>delta</em>\nepsilon zeta\n</p>" as
    // <p><em>delta</em> epsilon zeta </p>: the leading whitespace node is gone
    // and " epsilon zeta " is the ONLY text child, so it writes p/text().1.
    const doc3 = html('<p>\n<em>delta</em>\nepsilon zeta\n</p>');
    const c = new XCFI(doc3, 0);
    const cfi = c.xPointerToCFI(
      '/body/DocFragment[1]/body/p/text().1',
      '/body/DocFragment[1]/body/p/text().8',
    );
    expect(rangeText(doc3, cfi)).toBe('epsilon');
  });
});

describe('indexed /text()[K].N counts text children the way crengine keeps them', () => {
  // crengine: <p><em>b</em> c <em>d</em> e</p> — the leading "\n" is dropped,
  // " c " and " e" survive, so "e" is text()[2].1 (not [3] as raw DOM counting says).
  const doc = html('<p>\n<em>b</em> c <em>d</em> e</p>');
  const converter = new XCFI(doc, 0);

  it('resolves text()[2] to the second surviving text child', () => {
    const cfi = converter.xPointerToCFI(
      '/body/DocFragment[1]/body/p/text()[2].1',
      '/body/DocFragment[1]/body/p/text()[2].2',
    );
    expect(rangeText(doc, cfi)).toBe('e');
  });

  it('emits text()[2] for a selection in that text child', () => {
    const node = doc.querySelector('p')!.lastChild as Text; // " e"
    const range = doc.createRange();
    range.setStart(node, 1);
    range.setEnd(node, 2);
    const cfi = CFI.joinIndir(CFI.fake.fromIndex(0), CFI.fromRange(range));
    const xp = converter.cfiToXPointer(cfi);
    expect(xp.pos0).toBe('/body/DocFragment[1]/body/p/text()[2].1');
    expect(xp.pos1).toBe('/body/DocFragment[1]/body/p/text()[2].2');
  });
});

describe('dropped leading whitespace stays at the block start', () => {
  it.each([
    '',
    '\nepsilon',
    '\nepsilon<em>zeta</em>eta',
  ])('preserves a selection starting before inline content with trailing text %j', (trailingText) => {
    const doc = html(`<p>\n<em>delta</em>${trailingText}</p>`);
    const converter = new XCFI(doc, 0);
    const range = doc.createRange();
    range.setStart(doc.querySelector('p')!.firstChild!, 0);
    range.setEnd(doc.querySelector('em')!.firstChild!, 5);
    const cfi = CFI.joinIndir(CFI.fake.fromIndex(0), CFI.fromRange(range));

    const xp = converter.cfiToXPointer(cfi);

    expect(xp.pos0).toBe('/body/DocFragment[1]/body/p');
    expect(rangeText(doc, converter.xPointerToCFI(xp.pos0!, xp.pos1!)).trim()).toBe('delta');
  });
});

describe('offsets count crengine’s whitespace-collapsed text, not the raw source', () => {
  // crengine keeps "lambda   mu     nu" as "lambda mu nu": "mu" is text().7..9
  // there, while the raw DOM text node has it at 9..11.
  const doc = html('<p>lambda   mu     nu</p>');
  const converter = new XCFI(doc, 0);

  it('maps a crengine offset back to the raw text node', () => {
    const cfi = converter.xPointerToCFI(
      '/body/DocFragment[1]/body/p/text().7',
      '/body/DocFragment[1]/body/p/text().9',
    );
    expect(rangeText(doc, cfi)).toBe('mu');
  });

  it('emits collapsed offsets for a raw selection', () => {
    const node = doc.querySelector('p')!.firstChild as Text;
    const range = doc.createRange();
    range.setStart(node, 9);
    range.setEnd(node, 11);
    const cfi = CFI.joinIndir(CFI.fake.fromIndex(0), CFI.fromRange(range));
    const xp = converter.cfiToXPointer(cfi);
    expect(xp.pos0).toBe('/body/DocFragment[1]/body/p/text().7');
    expect(xp.pos1).toBe('/body/DocFragment[1]/body/p/text().9');
  });
});

describe('preformatted text keeps its whitespace, so offsets are raw there', () => {
  // crengine: <pre>alpha2  beta2</pre> has "beta2" at pre/text()[1].8, and the
  // same holds inside inline <code> outside any <pre>: "eta2" at code/text().8.
  const doc = html('<pre>alpha2  beta2\n    gamma2</pre><p><code>zeta2   eta2</code> theta2</p>');

  it.each([
    [
      'pre',
      '/body/DocFragment[1]/body/pre/text().8',
      '/body/DocFragment[1]/body/pre/text().13',
      'beta2',
    ],
    [
      'code',
      '/body/DocFragment[1]/body/p/code/text().8',
      '/body/DocFragment[1]/body/p/code/text().12',
      'eta2',
    ],
  ])('resolves a raw offset inside %s', (_tag, start, end, word) => {
    const cfi = new XCFI(doc, 0).xPointerToCFI(start, end);
    expect(rangeText(doc, cfi)).toBe(word);
  });

  it('emits raw offsets for a selection inside code', () => {
    const node = doc.querySelector('code')!.firstChild as Text;
    const range = doc.createRange();
    range.setStart(node, 8);
    range.setEnd(node, 12);
    const cfi = CFI.joinIndir(CFI.fake.fromIndex(0), CFI.fromRange(range));
    const xp = new XCFI(doc, 0).cfiToXPointer(cfi);
    expect(xp.pos0).toBe('/body/DocFragment[1]/body/p/code/text().8');
    expect(xp.pos1).toBe('/body/DocFragment[1]/body/p/code/text().12');
  });
});

describe('a single-spine-item book has /body/DocFragment/ with no index', () => {
  const doc = html('<p>only chapter</p>');

  it('extracts spine index 0', () => {
    expect(XCFI.extractSpineIndex('/body/DocFragment/body/p/text().5')).toBe(0);
  });

  it('converts crengine’s unindexed path to a CFI in section 0', () => {
    const cfi = new XCFI(doc, 0).xPointerToCFI(
      '/body/DocFragment/body/p/text().5',
      '/body/DocFragment/body/p/text().12',
    );
    expect(cfi.startsWith('epubcfi(/6/2!')).toBe(true);
    expect(rangeText(doc, cfi)).toBe('chapter');
  });
});
