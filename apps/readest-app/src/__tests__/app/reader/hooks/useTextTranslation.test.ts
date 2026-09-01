import { describe, it, expect } from 'vitest';
import {
  createTranslationTargetNode,
  getTranslationContextNodes,
  groupTextNodesByDocument,
  observeTextNodesByDocument,
  resolveTranslationSourceNodes,
  setSourceVisibility,
} from '@/app/reader/hooks/useTextTranslation';
import { walkTextNodes } from '@/utils/walk';

describe('groupTextNodesByDocument', () => {
  it('keeps text nodes from separate iframe documents in separate observer groups', () => {
    const firstDocument = document.implementation.createHTMLDocument('first');
    const secondDocument = document.implementation.createHTMLDocument('second');
    const firstNode = firstDocument.createElement('p');
    const secondNode = secondDocument.createElement('p');
    const anotherSecondNode = secondDocument.createElement('p');

    const groups = groupTextNodesByDocument([firstNode, secondNode, anotherSecondNode]);

    expect(groups.size).toBe(2);
    expect(groups.get(firstDocument)).toEqual([firstNode]);
    expect(groups.get(secondDocument)).toEqual([secondNode, anotherSecondNode]);
  });
});

describe('observeTextNodesByDocument', () => {
  it('creates one observer per iframe document and observes only that document nodes', () => {
    const firstDocument = document.implementation.createHTMLDocument('first');
    const secondDocument = document.implementation.createHTMLDocument('second');
    const firstNode = firstDocument.createElement('p');
    const secondNode = secondDocument.createElement('p');
    const observed = new Map<Document, HTMLElement[]>();
    const disconnected: Document[] = [];

    const observers = observeTextNodesByDocument([firstNode, secondNode], (ownerDocument) => {
      observed.set(ownerDocument, []);
      return {
        observe: (node: HTMLElement) => observed.get(ownerDocument)!.push(node),
        disconnect: () => disconnected.push(ownerDocument),
      } as unknown as IntersectionObserver;
    });

    expect(observers).toHaveLength(2);
    expect(observed.get(firstDocument)).toEqual([firstNode]);
    expect(observed.get(secondDocument)).toEqual([secondNode]);
    observers.forEach((observer) => observer.disconnect());
    expect(disconnected).toEqual([firstDocument, secondDocument]);
  });
});

describe('resolveTranslationSourceNodes', () => {
  it('keeps untranslated book text nodes', () => {
    const paragraph = document.createElement('p');
    paragraph.textContent = 'Source paragraph';

    expect(resolveTranslationSourceNodes([paragraph])).toEqual([paragraph]);
  });

  it('drops generated wrappers and folds a hidden original back to its paragraph', () => {
    const source = document.createElement('p');
    source.className = 'translation-source';
    const hiddenSource = document.createElement('font');
    hiddenSource.className = 'translation-source-hidden';
    hiddenSource.textContent = 'Source paragraph';
    const target = document.createElement('font');
    target.className = 'translation-target translation-target-block';
    target.textContent = 'Translated paragraph';
    source.append(hiddenSource, target);

    // one entry per paragraph, and never a generated wrapper
    expect(resolveTranslationSourceNodes([source, hiddenSource, target])).toEqual([source]);
  });

  it('keeps an already translated paragraph so the node list stays index-stable', () => {
    // Regression: dropping translated paragraphs shifts every index after them,
    // which breaks findNodeIndicesInRange and silently kills the read-ahead.
    const root = document.createElement('div');
    root.innerHTML = `<p id="p1">One.</p><p id="p2">Two.</p><p id="p3">Three.</p>`;
    document.body.appendChild(root);

    const translate = (el: HTMLElement, showSource: boolean) => {
      el.classList.add('translation-source');
      setSourceVisibility(el, showSource);
      el.appendChild(
        createTranslationTargetNode({
          translatedText: 'TRANSLATED',
          lang: 'zh',
          targetBlockClassName: 'translation-target-block',
          hidden: false,
          widthLineBreak: false,
        }),
      );
    };
    const rewalk = () =>
      resolveTranslationSourceNodes(walkTextNodes(root, ['pre', 'code', 'math']));

    expect(rewalk().map((node) => node.id)).toEqual(['p1', 'p2', 'p3']);

    // original left visible
    translate(document.getElementById('p1')!, true);
    expect(rewalk().map((node) => node.id)).toEqual(['p1', 'p2', 'p3']);

    // original hidden: walkTextNodes descends past the <p> and emits the wrapper
    translate(document.getElementById('p2')!, false);
    expect(rewalk().map((node) => node.id)).toEqual(['p1', 'p2', 'p3']);

    root.remove();
  });

  it('keeps a paragraph whose original is hidden but whose translation was removed', () => {
    // The state updateTranslation() leaves behind. The hidden wrapper is
    // display:none, so this paragraph must stay observable or it renders blank.
    const source = document.createElement('p');
    source.className = 'translation-source';
    source.textContent = 'Source paragraph';
    setSourceVisibility(source, false);
    const hider = source.querySelector<HTMLElement>('.translation-source-hidden')!;

    expect(resolveTranslationSourceNodes([hider])).toEqual([source]);
  });
});

describe('getTranslationContextNodes', () => {
  it('does not include adjacent context nodes from another document', () => {
    const firstDocument = document.implementation.createHTMLDocument('first');
    const secondDocument = document.implementation.createHTMLDocument('second');
    const firstBefore = firstDocument.createElement('p');
    const firstVisible = firstDocument.createElement('p');
    const secondAdjacent = secondDocument.createElement('p');
    const secondAfter = secondDocument.createElement('p');

    const context = getTranslationContextNodes(
      [firstBefore, firstVisible, secondAdjacent, secondAfter],
      firstDocument,
      new Set([firstVisible]),
    );

    expect(context).toEqual([firstBefore, firstVisible]);
    expect(context.every((node) => node.ownerDocument === firstDocument)).toBe(true);
  });

  it('returns nothing when every visible node belongs to another document', () => {
    const firstDocument = document.implementation.createHTMLDocument('first');
    const secondDocument = document.implementation.createHTMLDocument('second');
    const firstNode = firstDocument.createElement('p');
    const secondVisible = secondDocument.createElement('p');

    expect(
      getTranslationContextNodes(
        [firstNode, secondVisible],
        firstDocument,
        new Set([secondVisible]),
      ),
    ).toEqual([]);
  });

  it('spans the same window the pre-refactor loop covered', () => {
    const ownerDocument = document.implementation.createHTMLDocument('only');
    const nodes = Array.from({ length: 10 }, () => ownerDocument.createElement('p'));

    // visible = index 4 -> one node before, two after (old: startIdx..endIdx inclusive)
    expect(getTranslationContextNodes(nodes, ownerDocument, new Set([nodes[4]!]))).toEqual(
      nodes.slice(3, 7),
    );
    // clamps at both ends
    expect(getTranslationContextNodes(nodes, ownerDocument, new Set([nodes[0]!]))).toEqual(
      nodes.slice(0, 3),
    );
    expect(getTranslationContextNodes(nodes, ownerDocument, new Set([nodes[9]!]))).toEqual(
      nodes.slice(8, 10),
    );
  });
});

describe('createTranslationTargetNode', () => {
  it('sets dir="rtl" on the wrapper for an RTL target language', () => {
    const wrapper = createTranslationTargetNode({
      translatedText: 'مرحبا بالعالم',
      lang: 'ar',
      targetBlockClassName: 'translation-target-block',
      hidden: false,
      widthLineBreak: false,
    });

    expect(wrapper.getAttribute('lang')).toBe('ar');
    expect(wrapper.getAttribute('dir')).toBe('rtl');
  });

  it('sets dir="rtl" for a region-qualified RTL language (e.g. ar-EG)', () => {
    const wrapper = createTranslationTargetNode({
      translatedText: 'مرحبا',
      lang: 'ar-EG',
      targetBlockClassName: 'translation-target-block',
      hidden: false,
      widthLineBreak: false,
    });

    expect(wrapper.getAttribute('dir')).toBe('rtl');
  });

  it('sets dir="auto" on the wrapper for a non-RTL target language', () => {
    const wrapper = createTranslationTargetNode({
      translatedText: 'Hello world',
      lang: 'en',
      targetBlockClassName: 'translation-target-block',
      hidden: false,
      widthLineBreak: false,
    });

    expect(wrapper.getAttribute('dir')).toBe('auto');
  });

  it('builds a single flat wrapper carrying the translated text', () => {
    const wrapper = createTranslationTargetNode({
      translatedText: 'مرحبا بالعالم',
      lang: 'ar',
      targetBlockClassName: 'translation-target-toc',
      hidden: false,
      widthLineBreak: false,
    });

    expect(wrapper.classList.contains('translation-target')).toBe(true);
    expect(wrapper.classList.contains('translation-target-toc')).toBe(true);
    expect(wrapper.getAttribute('translation-element-mark')).toBe('1');
    expect(wrapper.textContent).toBe('مرحبا بالعالم');
    // Flattened from three nested <font>s: the CFI path into translated text
    // is two levels shallower, and no element nests inside the wrapper.
    expect(wrapper.children.length).toBe(0);
  });

  it('is a <font>, the one tag book CSS never styles and layout tolerates', () => {
    const wrapper = createTranslationTargetNode({
      translatedText: 'hi',
      lang: 'en',
      targetBlockClassName: 'translation-target-block',
      hidden: false,
      widthLineBreak: false,
    });
    expect(wrapper.tagName).toBe('FONT');
  });

  it('carries sanitized inline markup when given a content fragment', () => {
    const fragment = document.createDocumentFragment();
    fragment.appendChild(document.createTextNode('那只'));
    const bold = document.createElement('b');
    bold.textContent = '敏捷';
    fragment.appendChild(bold);
    fragment.appendChild(document.createTextNode('的狐狸'));

    const wrapper = createTranslationTargetNode({
      content: fragment,
      lang: 'zh',
      targetBlockClassName: 'translation-target-block',
      hidden: false,
      widthLineBreak: false,
    });

    expect(wrapper.textContent).toBe('那只敏捷的狐狸');
    expect(wrapper.querySelector('b')?.textContent).toBe('敏捷');
  });

  it('marks the wrapper hidden when hidden is true', () => {
    const wrapper = createTranslationTargetNode({
      translatedText: 'مرحبا',
      lang: 'ar',
      targetBlockClassName: 'translation-target-block',
      hidden: true,
      widthLineBreak: false,
    });

    expect(wrapper.classList.contains('hidden')).toBe(true);
  });

  it('prepends a <br> when widthLineBreak is true', () => {
    const wrapper = createTranslationTargetNode({
      translatedText: 'مرحبا',
      lang: 'ar',
      targetBlockClassName: 'translation-target-block',
      hidden: false,
      widthLineBreak: true,
    });

    expect(wrapper.firstChild?.nodeName).toBe('BR');
  });
});
