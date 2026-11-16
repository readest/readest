// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as CFI from 'foliate-js/epubcfi.js';

// A CFI step indexes its node among its parent's children. Doing that by walking all of them
// cost a long chapter (a few hundred paragraphs in one <div>) two walks of the parent for each
// conversion, start and end. On a Kindle running Readest Lite, where each DOM call is a native
// call, opening a book at its position took ~130 ms to resolve the position and another ~130 ms
// to write it back. Elements are at even indices (element k at 2k), so a step needs only the
// parent's elements, unless a filter or a cfi-inert or cfi-skip child changes the indices.

const XHTML = (str: string) => new DOMParser().parseFromString(str, 'application/xhtml+xml');
const page = (body: string) =>
  XHTML(
    `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>${body}</body></html>`,
  );

// Accepts every node: the filtered path indexes the children as the spec says, step by step.
const all = () => NodeFilter.FILTER_ACCEPT;

const point = (node: Node | null, offset: number) => [node, offset] as const;
const same = (a: Range | null, b: Range | null) =>
  a === b ||
  (!!a &&
    !!b &&
    [point(a.startContainer, a.startOffset), point(a.endContainer, a.endOffset)].every(
      ([n, o], i) =>
        i === 0
          ? n === b.startContainer && o === b.startOffset
          : n === b.endContainer && o === b.endOffset,
    ));

describe('EPUB CFI in a long parent', () => {
  afterEach(() => vi.restoreAllMocks());

  const paragraphs = Array.from(
    { length: 2000 },
    (_, i) => `<p>Paragraph ${i + 1} of the chapter.</p>`,
  ).join('\n');
  // a page that starts in paragraph 1101 and ends in paragraph 1111
  const pageOf = (doc: Document, parent: Element) => {
    const p = [...parent.children].filter((el) => el.localName === 'p');
    const range = doc.createRange();
    range.setStart(p[1100]!.firstChild!, 5);
    range.setEnd(p[1110]!.firstChild!, 9);
    return range;
  };
  const chapters = {
    'a chapter in a <div>': () => {
      const doc = page(`<div>${paragraphs}</div>`);
      return {
        doc,
        range: pageOf(doc, doc.body.firstElementChild!),
        cfi: '/4/2,/2202/1:5,/2222/1:9',
      };
    },
    // a single-file book, with the reader's skip link first in <body> (cfi-inert)
    'a book in <body> after a skip link': () => {
      const doc = page(`<a cfi-inert="" href="#">Skip</a>${paragraphs}`);
      return { doc, range: pageOf(doc, doc.body), cfi: '/4,/2202/1:5,/2222/1:9' };
    },
  };

  for (const [name, chapter] of Object.entries(chapters)) {
    it(`writes a position in ${name} without walking the parent's other children`, () => {
      const { range, cfi } = chapter();
      const next = vi.spyOn(Node.prototype, 'nextSibling', 'get');
      expect(CFI.fromRange(range)).toBe(`epubcfi(${cfi})`);
      expect(next.mock.calls.length).toBeLessThan(50);
    });

    it(`reads a position in ${name} without walking the parent's other children`, () => {
      const { doc, range, cfi } = chapter();
      const next = vi.spyOn(Node.prototype, 'nextSibling', 'get');
      expect(same(CFI.toRange(doc, CFI.parse(`epubcfi(${cfi})`)), range)).toBe(true);
      expect(next.mock.calls.length).toBeLessThan(50);
    });
  }
});

// Children of every shape the indexing distinguishes: text or an element first and last,
// elements with no text between them, text split in several nodes or around a comment, no
// children, only text, cfi-inert children, and a cfi-skip child (indexed the slow way).
const shapes: Record<string, (doc: Document, el: Element) => void> = {
  'elements only': (_, el) => (el.innerHTML = '<b>a</b><i>b</i><u>c</u>'),
  'text around elements': (_, el) => (el.innerHTML = 'x<b>a</b>y<i>b</i>z'),
  'element first, text last': (_, el) => (el.innerHTML = '<b>a</b>y<i>b</i>z'),
  'text first, element last': (_, el) => (el.innerHTML = 'x<b>a</b><i>b</i>'),
  'split text': (doc, el) => {
    el.innerHTML = '<b>a</b>';
    el.append(doc.createTextNode('one'), doc.createTextNode('two'), doc.createElement('i'));
    el.prepend(doc.createTextNode('p'), doc.createTextNode('q'));
    el.append(doc.createTextNode('r'), doc.createTextNode('s'));
  },
  'text around a comment': (doc, el) => {
    el.innerHTML = '<b>a</b>';
    el.append(doc.createTextNode('one'), doc.createComment('c'), doc.createTextNode('two'));
    el.append(doc.createElement('i'), doc.createComment('d'));
  },
  empty: () => {},
  'only text': (doc, el) => el.append(doc.createTextNode('one'), doc.createTextNode('two')),
  'a cfi-inert child': (_, el) => (el.innerHTML = 'x<a cfi-inert="">skip</a><b>a</b>y<i>b</i>'),
  'cfi-inert first and last': (_, el) =>
    (el.innerHTML = '<a cfi-inert="">s</a><b>a</b>y<i>b</i><a cfi-inert="">t</a>'),
  'cfi-inert between text': (_, el) =>
    (el.innerHTML = '<b>a</b>y<a cfi-inert="">s</a>z<i>b</i>w<a cfi-inert="">t</a>v'),
  'only cfi-inert': (_, el) => (el.innerHTML = '<a cfi-inert="">s</a>'),
  'a cfi-skip child': (_, el) => (el.innerHTML = 'x<div cfi-skip=""><b>a</b>y</div><i>b</i>z'),
};

describe('EPUB CFI steps', () => {
  for (const [name, fill] of Object.entries(shapes)) {
    const build = () => {
      const doc = page('<p>before</p><section id="s"></section><p>after</p>');
      fill(doc, doc.getElementById('s')!);
      return doc;
    };

    it(`reads every index of ${name} as the spec's indexing does`, () => {
      const doc = build();
      const s = doc.getElementById('s')!;
      // the section is the body's second element
      const max = 2 * s.childNodes.length + 4;
      for (let index = 0; index <= max; index++)
        for (const offset of ['', ':0', ':1', ':3', ':4', ':9']) {
          const parts = CFI.parse(`epubcfi(/4/4/${index}${offset})`);
          const read = CFI.toRange(doc, parts);
          expect(same(read, CFI.toRange(doc, parts, all)), `/${index}${offset}`).toBe(true);
        }
    });

    it(`writes every point in ${name} as the spec's indexing does`, () => {
      const doc = build();
      const s = doc.getElementById('s')!;
      const before = doc.body.firstElementChild!.firstChild!;
      const after = doc.body.lastElementChild!.firstChild!;
      const nodes = [s, ...s.querySelectorAll('*')].flatMap((el) => [el, ...el.childNodes]);
      for (const node of nodes) {
        const length = node.nodeType === 1 ? node.childNodes.length : (node.nodeValue ?? '').length;
        for (let offset = 0; offset <= length; offset++) {
          const from = doc.createRange();
          from.setStart(node, offset);
          from.setEnd(after, 2);
          const to = doc.createRange();
          to.setStart(before, 2);
          to.setEnd(node, offset);
          for (const range of [from, to])
            expect(CFI.fromRange(range), `${node.nodeName} ${offset}`).toBe(
              CFI.fromRange(range, all),
            );
        }
      }
    });
  }
});
