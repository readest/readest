import { afterEach, describe, expect, it } from 'vitest';
import { extractToBody } from 'foliate-js/footnotes.js';

// A popup shows only the note's contents, but books style a note through the
// element it lives in: rules scoped under it (`aside.note p.pinyin`), sizes
// the note inherits from it, the note box itself (#7103).
const BOOK_CSS = `
  body { font-size: 16px; font-family: serif; }
  aside.note { display: none; border-left: 3px solid rgb(200, 0, 0); padding-left: 6px; }
  aside.note p.pinyin { font-family: monospace; border-bottom: 1px dotted; letter-spacing: 0.05em; }
  aside.small { font-size: 0.6em; }
  p.half { font-size: 0.5em; }
  aside.side { float: right; width: 30%; margin-right: -40%; position: absolute; }
`;

let iframe: HTMLIFrameElement | null = null;

const popupOf = (html: string, noteId: string) => {
  iframe = document.createElement('iframe');
  iframe.style.width = '400px';
  iframe.style.height = '300px';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.head.innerHTML = `<style>${BOOK_CSS}</style>`;
  doc.body.innerHTML = `<p>Text<a href="#${noteId}">1</a></p><section class="notes">${html}</section>`;
  const range = doc.createRange();
  range.selectNodeContents(doc.getElementById(noteId)!);
  extractToBody(doc, range);
  return { doc, style: (el: Element) => doc.defaultView!.getComputedStyle(el) };
};

afterEach(() => {
  iframe?.remove();
  iframe = null;
});

describe('footnote extraction keeps the note container', () => {
  it('applies rules scoped under the note element', () => {
    const { doc, style } = popupOf(
      `<aside class="note" id="n1"><p class="pinyin">mǎ</p><p class="def">horse</p></aside>`,
      'n1',
    );
    const pinyin = style(doc.querySelector('p.pinyin')!);
    expect(pinyin.fontFamily).toBe('monospace');
    expect(pinyin.borderBottomStyle).toBe('dotted');
    expect(pinyin.letterSpacing).toBe('0.8px');
    expect(style(doc.querySelector('p.def')!).fontFamily).toBe('serif');
  });

  it('keeps the size the note inherits from its element', () => {
    const { doc, style } = popupOf(
      `<aside class="small" id="n2"><p class="a">a</p><p class="half">b</p></aside>`,
      'n2',
    );
    expect(style(doc.querySelector('p.a')!).fontSize).toBe('9.6px');
    expect(style(doc.querySelector('p.half')!).fontSize).toBe('4.8px');
  });

  it('shows a note whose element the book hides or floats aside', () => {
    const { doc, style } = popupOf(
      `<aside class="note side" id="n3"><p class="def">a side note</p></aside>`,
      'n3',
    );
    const def = doc.querySelector('p.def')!;
    expect(def.getClientRects().length).toBeGreaterThan(0);
    expect(def.getBoundingClientRect().width).toBe(doc.body.getBoundingClientRect().width - 9);
    // the note box itself still draws
    expect(style(def.parentElement!).borderLeftStyle).toBe('solid');
  });

  it('shows a list note without a list marker or its indent', () => {
    const { doc, style } = popupOf(`<ul class="fn"><li id="n4">note</li></ul>`, 'n4');
    expect(doc.body.textContent).toBe('note');
    const li = doc.querySelector('li')!;
    expect(style(li).display).toBe('block');
    expect(li.getBoundingClientRect().left).toBe(doc.body.getBoundingClientRect().left);
  });
});
