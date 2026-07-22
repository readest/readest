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

  it('builds the expected nested structure with the translated text', () => {
    const wrapper = createTranslationTargetNode({
      translatedText: 'مرحبا بالعالم',
      lang: 'ar',
      targetBlockClassName: 'translation-target-toc',
      hidden: false,
      widthLineBreak: false,
    });

    expect(wrapper.classList.contains('translation-target')).toBe(true);
    expect(wrapper.getAttribute('translation-element-mark')).toBe('1');
    const block = wrapper.querySelector('.translation-target-toc');
    expect(block).not.toBeNull();
    const inner = wrapper.querySelector('.target-inner');
    expect(inner?.textContent).toBe('مرحبا بالعالم');
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
