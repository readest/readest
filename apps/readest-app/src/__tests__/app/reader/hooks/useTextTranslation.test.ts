import { describe, it, expect } from 'vitest';
import { createTranslationTargetNode } from '@/app/reader/hooks/useTextTranslation';

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
