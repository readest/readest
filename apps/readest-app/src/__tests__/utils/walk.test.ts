import { describe, test, expect } from 'vitest';
import { walkTextNodes } from '@/utils/walk';

/**
 * Helper to create an element tree from a simple spec.
 */
function el(tag: string, ...children: (HTMLElement | string)[]): HTMLElement {
  const elem = document.createElement(tag);
  for (const child of children) {
    if (typeof child === 'string') {
      elem.appendChild(document.createTextNode(child));
    } else {
      elem.appendChild(child);
    }
  }
  return elem;
}

describe('walkTextNodes', () => {
  test('collects leaf elements with text', () => {
    const root = el('div', el('p', 'Hello'), el('p', 'World'));
    const result = walkTextNodes(root);
    expect(result).toHaveLength(2);
    expect(result[0]!.textContent).toBe('Hello');
    expect(result[1]!.textContent).toBe('World');
  });

  test('collects a single leaf element', () => {
    const root = el('div', el('span', 'Only child'));
    const result = walkTextNodes(root);
    expect(result).toHaveLength(1);
    expect(result[0]!.tagName).toBe('SPAN');
    expect(result[0]!.textContent).toBe('Only child');
  });

  test('recurses into nested elements without direct text', () => {
    // div > section > article > p("Deep text")
    const root = el('div', el('section', el('article', el('p', 'Deep text'))));
    const result = walkTextNodes(root);
    expect(result).toHaveLength(1);
    expect(result[0]!.textContent).toBe('Deep text');
  });

  test('collects element with direct text node even if it has child elements', () => {
    // A paragraph with both a text node and a child element
    const p = document.createElement('p');
    p.appendChild(document.createTextNode('Direct text '));
    p.appendChild(el('em', 'emphasized'));
    const root = el('div', p);
    const result = walkTextNodes(root);
    // The <p> has a direct text node "Direct text ", so it should be collected
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(p);
  });

  test('collects element with span child containing text', () => {
    const p = document.createElement('p');
    p.appendChild(el('span', 'span text'));
    const root = el('div', p);
    const result = walkTextNodes(root);
    // The <p> has a SPAN child with text, so hasDirectText is true
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(p);
  });

  test('does not collect span child separately when parent has hasDirectText', () => {
    // When parent is collected via hasDirectText, children are not walked further
    const span = el('span', 'inner');
    const p = document.createElement('p');
    p.appendChild(span);
    const root = el('div', p);
    const result = walkTextNodes(root);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(p);
    // The span should not appear separately
    expect(result).not.toContain(span);
  });

  test('skips STYLE tags', () => {
    const root = el('div', el('style', 'body { color: red; }'), el('p', 'Visible'));
    const result = walkTextNodes(root);
    expect(result).toHaveLength(1);
    expect(result[0]!.textContent).toBe('Visible');
  });

  test('skips LINK tags', () => {
    const link = document.createElement('link');
    link.setAttribute('rel', 'stylesheet');
    const root = el('div', link, el('p', 'Content'));
    const result = walkTextNodes(root);
    expect(result).toHaveLength(1);
    expect(result[0]!.textContent).toBe('Content');
  });

  test('skips tags in rejectTags (case insensitive)', () => {
    const root = el('div', el('nav', 'Navigation'), el('p', 'Body text'), el('footer', 'Footer'));
    const result = walkTextNodes(root, ['nav', 'footer']);
    expect(result).toHaveLength(1);
    expect(result[0]!.textContent).toBe('Body text');
  });

  test('rejectTags comparison is lowercase against element tagName', () => {
    const root = el('div', el('aside', 'Sidebar'), el('p', 'Main'));
    // tagName is uppercase in DOM, rejectTags should be lowercase per the code
    const result = walkTextNodes(root, ['aside']);
    expect(result).toHaveLength(1);
    expect(result[0]!.textContent).toBe('Main');
  });

  test('filters out elements with empty or whitespace-only text', () => {
    const root = el('div', el('p', '   '), el('p', ''), el('p', 'Actual text'));
    const result = walkTextNodes(root);
    expect(result).toHaveLength(1);
    expect(result[0]!.textContent).toBe('Actual text');
  });

  test('handles empty root element', () => {
    const root = document.createElement('div');
    const result = walkTextNodes(root);
    expect(result).toHaveLength(0);
  });

  test('handles root with only whitespace text nodes', () => {
    const root = el('div', el('p', '  \n\t  '));
    const result = walkTextNodes(root);
    expect(result).toHaveLength(0);
  });

  test('handles mixed content: some with text, some empty', () => {
    const root = el(
      'div',
      el('p', 'First'),
      el('div', el('span', '')),
      el('p', 'Second'),
      el('div'),
    );
    const result = walkTextNodes(root);
    expect(result).toHaveLength(2);
    expect(result[0]!.textContent).toBe('First');
    expect(result[1]!.textContent).toBe('Second');
  });

  test('deeply nested structure is walked recursively', () => {
    // Build a chain: div > div > div > ... > p("Deep")
    let inner: HTMLElement = el('p', 'Deep');
    for (let i = 0; i < 10; i++) {
      inner = el('div', inner);
    }
    const root = el('div', inner);
    const result = walkTextNodes(root);
    expect(result).toHaveLength(1);
    expect(result[0]!.textContent).toBe('Deep');
  });

  test('respects recursion depth limit of 15', () => {
    // Build a chain deeper than 15 levels
    // walk starts at depth 0, increments for each recursive call
    // depth > 15 means we stop at depth 16
    let inner: HTMLElement = el('p', 'TooDeep');
    for (let i = 0; i < 20; i++) {
      inner = el('div', inner);
    }
    const root = el('div', inner);
    const result = walkTextNodes(root);
    // The text is at depth ~22 from root, so it should not be reached
    expect(result).toHaveLength(0);
  });

  test('collects multiple text elements at different levels', () => {
    const root = el(
      'div',
      el('h1', 'Title'),
      el('section', el('p', 'Paragraph 1'), el('p', 'Paragraph 2')),
      el('footer', el('small', 'Copyright')),
    );
    const result = walkTextNodes(root);
    expect(result).toHaveLength(4);
    expect(result.map((e) => e.textContent)).toEqual([
      'Title',
      'Paragraph 1',
      'Paragraph 2',
      'Copyright',
    ]);
  });

  test('default rejectTags is empty array', () => {
    const root = el('div', el('nav', 'Nav'), el('p', 'Body'));
    const result = walkTextNodes(root);
    expect(result).toHaveLength(2);
  });

  test('skips STYLE and LINK even when not in rejectTags', () => {
    const root = el('div', el('style', '.cls {}'), el('p', 'Text'));
    // Not passing rejectTags, STYLE should still be skipped
    const result = walkTextNodes(root);
    expect(result).toHaveLength(1);
    expect(result[0]!.textContent).toBe('Text');
  });

  test.skip('walks into shadow DOM (requires real shadow DOM support)', () => {
    // jsdom has limited shadow DOM support; skipping for now
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.appendChild(el('p', 'Shadow text'));
    const root = el('div', host);
    const result = walkTextNodes(root);
    expect(result).toHaveLength(1);
    expect(result[0]!.textContent).toBe('Shadow text');
  });

  test.skip('walks into iframe contentDocument (not supported in jsdom)', () => {
    // jsdom iframes do not have usable contentDocument; skipping
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    const iframeDoc = iframe.contentDocument;
    if (iframeDoc) {
      iframeDoc.body.appendChild(el('p', 'Iframe text'));
    }
    const root = el('div', iframe);
    const result = walkTextNodes(root);
    expect(result).toHaveLength(1);
    document.body.removeChild(iframe);
  });
});
