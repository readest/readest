import { describe, it, expect } from 'vitest';
import * as CFI from 'foliate-js/epubcfi.js';
import {
  createTranslationTargetNode,
  setSourceVisibility,
} from '@/app/reader/hooks/useTextTranslation';

/**
 * A highlight must land on the same text whether or not translation is on, and
 * whether it was created before or after translating. Translation appends its
 * target node to the end of the source element, which leaves every preceding
 * text-node offset and element index untouched — these tests lock that in, so a
 * future change (injecting mid-element, or wrapping the source) cannot silently
 * shift saved CFIs.
 */
const XHTML = (str: string) => new DOMParser().parseFromString(str, 'application/xhtml+xml');

const WORD = 'growth';

const page = () =>
  XHTML(`<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>T</title></head>
  <body id="b">
    <p id="p1">First paragraph</p>
    <div id="p2">Veganism is experiencing unprecedented growth globally.</div>
    <p id="p3">Third paragraph here</p>
  </body>
</html>`);

const translated = (doc: Document) => {
  const el = doc.getElementById('p2')!;
  el.appendChild(
    createTranslationTargetNode({
      translatedText: '素食主义正在经历前所未有的增长。',
      lang: 'zh',
      targetBlockClassName: 'translation-target-block',
      hidden: false,
      widthLineBreak: false,
    }),
  );
  return doc;
};

/** CFI of the word inside #p2's own text node. */
const cfiForWord = (doc: Document) => {
  const el = doc.getElementById('p2')!;
  const textNode = Array.from(el.childNodes).find(
    (n) => n.nodeType === Node.TEXT_NODE && n.textContent!.includes(WORD),
  ) as Text;
  const start = textNode.textContent!.indexOf(WORD);
  const range = doc.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, start + WORD.length);
  return CFI.fromRange(range);
};

const resolve = (doc: Document, cfi: string) =>
  CFI.toRange(doc, CFI.parse(cfi))?.toString() ?? null;

describe('CFI stability across translation', () => {
  it('produces the same CFI before and after the translation node is appended', () => {
    expect(cfiForWord(translated(page()))).toBe(cfiForWord(page()));
  });

  it('resolves a pre-translation CFI to the same word after translating', () => {
    const cfi = cfiForWord(page());
    expect(resolve(translated(page()), cfi)).toBe(WORD);
  });

  it('resolves a post-translation CFI to the same word once translation is off', () => {
    const cfi = cfiForWord(translated(page()));
    expect(resolve(page(), cfi)).toBe(WORD);
  });

  it('keeps a source CFI resolvable when the original text is hidden', () => {
    // Previously the original's text nodes were blanked (textContent = ''),
    // which destroyed the anchor: the highlight had nothing left to resolve to.
    // The original is now wrapped in a cfi-skip element instead, so indices and
    // offsets survive being hidden.
    const cfi = cfiForWord(page());

    const doc = translated(page());
    setSourceVisibility(doc.getElementById('p2')!, false);

    expect(doc.getElementById('p2')!.querySelector('[cfi-skip]')).not.toBeNull();
    expect(resolve(doc, cfi)).toBe(WORD);
  });

  it('restores the original in place when it is shown again', () => {
    const doc = translated(page());
    const el = doc.getElementById('p2')!;
    const before = el.textContent;

    setSourceVisibility(el, false);
    setSourceVisibility(el, true);

    expect(el.querySelector('[cfi-skip]')).toBeNull();
    expect(el.textContent).toBe(before);
    expect(resolve(doc, cfiForWord(page()))).toBe(WORD);
  });

  it('produces the same source CFI whether the original is shown or hidden', () => {
    const shown = translated(page());
    const hidden = translated(page());
    setSourceVisibility(hidden.getElementById('p2')!, false);

    // Generating a CFI needs the text present; hiding must not move it.
    const cfi = cfiForWord(shown);
    expect(resolve(hidden, cfi)).toBe(WORD);
  });

  it('keeps CFIs of following elements stable when an earlier element is translated', () => {
    const cfiOf = (doc: Document) => {
      const textNode = doc.getElementById('p3')!.firstChild as Text;
      const range = doc.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, 5);
      return CFI.fromRange(range);
    };
    const before = cfiOf(page());
    expect(cfiOf(translated(page()))).toBe(before);
    expect(resolve(translated(page()), before)).toBe('Third');
  });
});
