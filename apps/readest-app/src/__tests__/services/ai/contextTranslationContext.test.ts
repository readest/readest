import { describe, expect, it } from 'vitest';

import { buildContextTranslationContext } from '@/services/ai/contextTranslationContext';

const selectText = (container: HTMLElement, text: string) => {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const index = node.textContent?.indexOf(text) ?? -1;
    if (index >= 0) {
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + text.length);
      return range;
    }
  }
  throw new Error(`Text not found: ${text}`);
};

describe('buildContextTranslationContext', () => {
  it('preserves nearby text around the selection', () => {
    document.body.innerHTML = '<p>When reading, looking up selected text often requires careful context.</p>';
    const range = selectText(document.body, 'requires');

    const context = buildContextTranslationContext({ text: 'requires', range }, 80);

    expect(context.beforeContext).toBe('When reading, looking up selected text often');
    expect(context.afterContext).toBe('careful context.');
    expect(context.sentence).toBe(
      'When reading, looking up selected text often requires careful context.',
    );
    expect(context.paragraph).toBe(
      'When reading, looking up selected text often requires careful context.',
    );
  });

  it('trims surrounding context to the max character budget', () => {
    document.body.innerHTML = `<p>${'before '.repeat(20)}target ${'after '.repeat(20)}</p>`;
    const range = selectText(document.body, 'target');

    const context = buildContextTranslationContext({ text: 'target', range }, 30);

    expect(context.beforeContext.length + 'target'.length + context.afterContext.length).toBeLessThanOrEqual(
      30,
    );
    expect(context.beforeContext.endsWith('before')).toBe(true);
    expect(context.afterContext.startsWith('after')).toBe(true);
  });
});
