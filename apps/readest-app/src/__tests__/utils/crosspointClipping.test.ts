import { describe, expect, it } from 'vitest';
import { clippingOffsets, clippingRange } from '@/utils/crosspointClipping';

// A section as foliate loads it: XHTML parsed as XML, whitespace kept.
const xhtml = (body: string, head = '<title>Chapter</title><style>p{}</style>') =>
  new DOMParser().parseFromString(
    `<?xml version="1.0" encoding="utf-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml"><head>${head}</head><body>${body}</body></html>`,
    'application/xhtml+xml',
  );

// CrossPoint counts the code points of every character in <body>, whitespace
// included, outside head/style/script/title/rp (ChapterHtmlSlimParser
// characterData). Offsets below are counted by hand over the body text.
const BODY =
  '\n<h1>Six</h1>\n' + // "\n" 0, "Six" 1-4, "\n" 4
  '<p>Winter was <em>every</em> kid’s</p>\n' + // "Winter was " 5-16, "every" 16-21, " kid’s" 21-27, "\n" 27
  '<style>p{}</style><script>var x;</script>' + // not counted
  '<p>An \u{1F600} and <ruby>漢<rp>(</rp><rt>kan</rt><rp>)</rp></ruby> stove.</p>'; // "An " 28-31, emoji 31, " and " 32-37, 漢 37, "kan" 38-41, " stove." 41-48

describe('clippingRange', () => {
  const doc = xhtml(BODY);

  it('resolves the code-point range CrossPoint saved', () => {
    expect(
      clippingRange(doc, { start_offset: 16, end_offset: 27 }, 'every kid’s')?.toString(),
    ).toBe('every kid’s');
  });

  it('counts an emoji as one code point and skips rp, script and style text', () => {
    const range = clippingRange(doc, { start_offset: 33, end_offset: 48 }, 'and 漢kan stove.');
    const p = doc.getElementsByTagName('p')[1]!;
    expect(range?.startContainer).toBe(p.firstChild);
    expect(range?.startOffset).toBe('An \u{1F600} '.length); // UTF-16 units
    expect(range?.endContainer).toBe(p.lastChild);
    expect(range?.endOffset).toBe(' stove.'.length);
  });

  it('matches the clipping text whatever whitespace CrossPoint joined the words with', () => {
    // The firmware joins the words of a selection across paragraphs with "\n"
    // and collapses any whitespace run to one space.
    expect(
      clippingRange(doc, { start_offset: 5, end_offset: 21 }, 'Winter was\nevery')?.toString(),
    ).toBe('Winter was every');
  });

  it('finds the text near the saved offset when the offsets do not match it', () => {
    // A copy CrossPoint rewrote (Optimize EPUB) can shift the offsets.
    const range = clippingRange(doc, { start_offset: 20, end_offset: 31 }, 'every kid’s');
    expect(range?.toString()).toBe('every kid’s');
  });

  it('picks the occurrence closest to the saved offset', () => {
    const twice = xhtml('<p>the cat sat</p><p>the cat ran</p>');
    // "the cat sat" 0-11, "the cat ran" 11-22
    const range = clippingRange(twice, { start_offset: 12, end_offset: 19 }, 'the cat');
    expect(range?.startOffset).toBe(0);
    expect(range?.startContainer.parentNode?.textContent).toBe('the cat ran');
  });

  it('finds the text without offsets (an older clipping)', () => {
    // Across the style and script between the paragraphs, which it skips.
    const range = clippingRange(doc, {}, 'kid’s An');
    expect(range?.startContainer.textContent).toBe(' kid’s');
    expect(range?.startOffset).toBe(1);
    expect(range?.endContainer).toBe(doc.getElementsByTagName('p')[1]!.firstChild);
    expect(range?.endOffset).toBe(2);
  });

  it('gives no range for text the section does not have', () => {
    expect(clippingRange(doc, { start_offset: 5, end_offset: 11 }, 'Bulgaria')).toBeNull();
  });
});

describe('clippingOffsets', () => {
  const doc = xhtml(BODY);

  it('gives the range of a selection in CrossPoint code points', () => {
    const em = doc.getElementsByTagName('em')[0]!;
    const range = doc.createRange();
    range.setStart(em.firstChild!, 0);
    range.setEnd(em.nextSibling!, 6); // " kid’s"
    expect(clippingOffsets(doc, range)).toEqual({ start_offset: 16, end_offset: 27 });
  });

  it('counts astral characters once and skips rp text', () => {
    const p = doc.getElementsByTagName('p')[1]!;
    const tail = p.lastChild as Text; // " stove."
    const range = doc.createRange();
    range.setStart(p.firstChild!, 6); // after "An 😀 ": 6 UTF-16 units, 5 code points
    range.setEnd(tail, 7);
    expect(clippingOffsets(doc, range)).toEqual({ start_offset: 33, end_offset: 48 });
  });

  it('reads element boundaries as the text before them', () => {
    const p = doc.getElementsByTagName('p')[0]!;
    const range = doc.createRange();
    range.setStart(p, 0);
    range.setEnd(p, p.childNodes.length);
    expect(clippingOffsets(doc, range)).toEqual({ start_offset: 5, end_offset: 27 });
  });

  it('round-trips through clippingRange', () => {
    const p = doc.getElementsByTagName('p')[0]!;
    const range = doc.createRange();
    range.setStart(p.firstChild!, 7); // "was eve"
    range.setEnd(doc.getElementsByTagName('em')[0]!.firstChild!, 3);
    const offsets = clippingOffsets(doc, range)!;
    expect(clippingRange(doc, offsets, range.toString())?.toString()).toBe(range.toString());
  });

  it('gives nothing for a collapsed range', () => {
    const range = doc.createRange();
    range.setStart(doc.getElementsByTagName('em')[0]!.firstChild!, 2);
    expect(clippingOffsets(doc, range)).toBeNull();
  });
});
