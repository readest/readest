import { describe, expect, test } from 'vitest';
import { textWalker } from 'foliate-js/text-walker.js';

// A chapter's paragraphs usually share one ancestor (the body or a wrapper),
// so a paragraph's range has that ancestor as its commonAncestorContainer.
// Walking it must start at the paragraph, not at the chapter's first node:
// otherwise reading paragraph N costs N paragraphs of DOM work (and node
// filter calls), and a long chapter stalls the main thread for seconds.
const makeChapter = (paragraphs: number): Document =>
  new DOMParser().parseFromString(
    `<!DOCTYPE html><html><body><div>${Array.from(
      { length: paragraphs },
      (_, i) => `<p>Paragraph ${i} has <em>some</em> text.</p>`,
    ).join('')}</div></body></html>`,
    'text/html',
  );

const paragraphRange = (doc: Document, index: number): Range => {
  const ps = doc.querySelectorAll('p');
  const range = doc.createRange();
  range.setStart(ps[index]!, 0);
  range.setEndBefore(ps[index + 1]!);
  return range;
};

const collect = (range: Range, filter: (node: Node) => number) => {
  const texts: string[] = [];
  for (const text of textWalker(range, (strs: string[]) => [strs.join('')], filter)) {
    texts.push(text as string);
  }
  return texts;
};

describe('textWalker on a paragraph of a long chapter', () => {
  test('collects only the paragraph text', () => {
    const doc = makeChapter(50);
    const accept = (node: Node) =>
      node.nodeType === Node.TEXT_NODE ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    expect(collect(paragraphRange(doc, 40), accept)).toEqual(['Paragraph 40 has some text.']);
    expect(collect(paragraphRange(doc, 0), accept)).toEqual(['Paragraph 0 has some text.']);
  });

  test('never visits nodes before the paragraph', () => {
    const doc = makeChapter(500);
    let visited = 0;
    const counting = (node: Node) => {
      visited++;
      return node.nodeType === Node.TEXT_NODE ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    };
    expect(collect(paragraphRange(doc, 400), counting)).toEqual(['Paragraph 400 has some text.']);
    // The paragraph's own nodes plus the first node past it, not 400 paragraphs.
    expect(visited).toBeLessThan(20);
  });

  test('respects a filter that rejects part of the paragraph', () => {
    const doc = makeChapter(10);
    const noEm = (node: Node) => {
      if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === 'EM')
        return NodeFilter.FILTER_REJECT;
      return node.nodeType === Node.TEXT_NODE ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    };
    expect(collect(paragraphRange(doc, 5), noEm)).toEqual(['Paragraph 5 has  text.']);
  });

  test('a range starting inside a rejected element stays rejected', () => {
    const doc = makeChapter(3);
    const em = doc.querySelectorAll('em')[1]!;
    const range = doc.createRange();
    range.setStart(em.firstChild!, 0);
    range.setEndBefore(doc.querySelectorAll('p')[2]!);
    const noEm = (node: Node) => {
      if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === 'EM')
        return NodeFilter.FILTER_REJECT;
      return node.nodeType === Node.TEXT_NODE ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    };
    expect(collect(range, noEm)).toEqual([' text.']);
  });
});
