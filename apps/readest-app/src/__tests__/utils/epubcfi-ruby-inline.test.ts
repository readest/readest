import { describe, it, expect } from 'vitest';
import * as CFI from 'foliate-js/epubcfi.js';

const XHTML = (str: string) => new DOMParser().parseFromString(str, 'application/xhtml+xml');

const rangeInParagraph = (doc: Document, pId: string, start: number, end: number): Range => {
  const p = doc.getElementById(pId)!;
  const walker = doc.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  const node = walker.nextNode() as Text;
  const range = doc.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  return range;
};

const wrap = (html: string) =>
  XHTML(`<html xmlns="http://www.w3.org/1999/xhtml"><body id="b">${html}</body></html>`);

describe('epubcfi mid-text inline ruby transparency', () => {
  it('produces the same CFI for a glossed word as for plain text', () => {
    const plain = wrap(`<p id="p">The quick fox</p>`);
    const plainCfi = CFI.fromRange(rangeInParagraph(plain, 'p', 4, 9));

    const ruby = wrap(
      `<p id="p">The <ruby cfi-skip="">quick<rt cfi-inert="">x</rt></ruby> fox</p>`,
    );
    const p = ruby.getElementById('p')!;
    const rb = p.querySelector('ruby')!.firstChild as Text; // "quick"
    const r = ruby.createRange();
    r.setStart(rb, 0);
    r.setEnd(rb, 5);

    expect(CFI.fromRange(r)).toBe(plainCfi);
  });

  it('round-trips a saved CFI through the glossed DOM to the right text', () => {
    const plain = wrap(`<p id="p">The quick fox</p>`);
    const cfi = CFI.fromRange(rangeInParagraph(plain, 'p', 4, 9)); // "quick"

    const ruby = wrap(
      `<p id="p">The <ruby cfi-skip="">quick<rt cfi-inert="">x</rt></ruby> fox</p>`,
    );
    const resolved = CFI.toRange(ruby, CFI.parse(cfi));
    expect(resolved.toString()).toBe('quick');
  });

  it('keeps offsets stable for text AFTER the gloss', () => {
    const plain = wrap(`<p id="p">The quick fox</p>`);
    const plainCfi = CFI.fromRange(rangeInParagraph(plain, 'p', 10, 13));

    const ruby = wrap(
      `<p id="p">The <ruby cfi-skip="">quick<rt cfi-inert="">x</rt></ruby> fox</p>`,
    );
    const p = ruby.getElementById('p')!;
    const after = p.querySelector('ruby')!.nextSibling as Text; // " fox"
    const r = ruby.createRange();
    r.setStart(after, 1);
    r.setEnd(after, 4);
    expect(CFI.fromRange(r)).toBe(plainCfi);
  });
});
