import { describe, expect, it } from 'vitest';

import {
  getParagraphActionForKey,
  getParagraphActionForZone,
  getParagraphButtonDirections,
  getParagraphPresentation,
} from '@/utils/paragraphPresentation';

const createDoc = (body: string): Document =>
  new DOMParser().parseFromString(`<html><body>${body}</body></html>`, 'text/html');

const attachDefaultView = (
  doc: Document,
  getComputedStyle: (element: Element) => CSSStyleDeclaration,
) => {
  Object.defineProperty(doc, 'defaultView', {
    value: { getComputedStyle },
    configurable: true,
  });
};

describe('paragraphPresentation', () => {
  it('preserves vertical writing metadata from the source document', () => {
    const doc = createDoc('<p lang="ja">縦書きの段落です。</p>');
    const paragraph = doc.querySelector('p')!;
    const range = doc.createRange();
    range.selectNodeContents(paragraph);

    attachDefaultView(doc, (element: Element) => {
      if (element === paragraph || element === doc.body) {
        return {
          writingMode: 'vertical-rl',
          direction: 'ltr',
          textOrientation: 'upright',
          unicodeBidi: 'plaintext',
          textAlign: 'start',
        } as CSSStyleDeclaration;
      }

      return {
        writingMode: 'horizontal-tb',
        direction: 'ltr',
      } as CSSStyleDeclaration;
    });

    expect(getParagraphPresentation(doc, range)).toEqual(
      expect.objectContaining({
        lang: 'ja',
        dir: 'ltr',
        writingMode: 'vertical-rl',
        textOrientation: 'upright',
        vertical: true,
      }),
    );
  });

  it('preserves rtl direction from the source document', () => {
    const doc = createDoc('<p dir="rtl">هذا نص عربي</p>');
    const paragraph = doc.querySelector('p')!;
    const range = doc.createRange();
    range.selectNodeContents(paragraph);

    attachDefaultView(
      doc,
      () =>
        ({
          writingMode: 'horizontal-tb',
          direction: 'rtl',
          textAlign: 'start',
        }) as CSSStyleDeclaration,
    );

    expect(getParagraphPresentation(doc, range)).toEqual(
      expect.objectContaining({
        dir: 'rtl',
        rtl: true,
        writingMode: 'horizontal-tb',
      }),
    );
  });

  it('maps navigation consistently across ltr, rtl, and vertical layouts', () => {
    expect(getParagraphActionForZone('left', { rtl: false, vertical: false })).toBe('prev');
    expect(getParagraphActionForZone('left', { rtl: true, vertical: false })).toBe('next');
    expect(getParagraphActionForZone('top', { vertical: true, writingMode: 'vertical-rl' })).toBe(
      'prev',
    );

    expect(getParagraphActionForKey('ArrowRight', { rtl: false, vertical: false })).toBe('next');
    expect(getParagraphActionForKey('ArrowLeft', { rtl: true, vertical: false })).toBe('next');
    expect(
      getParagraphActionForKey('ArrowLeft', { vertical: true, writingMode: 'vertical-rl' }),
    ).toBe('next');

    expect(getParagraphButtonDirections({ rtl: false, vertical: false })).toEqual({
      prev: 'left',
      next: 'right',
    });
    expect(getParagraphButtonDirections({ rtl: true, vertical: false })).toEqual({
      prev: 'right',
      next: 'left',
    });
    expect(getParagraphButtonDirections({ vertical: true, writingMode: 'vertical-rl' })).toEqual({
      prev: 'up',
      next: 'down',
    });
  });
});
