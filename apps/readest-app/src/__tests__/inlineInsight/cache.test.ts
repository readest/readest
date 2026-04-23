import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearInlineInsightCache,
  InlineInsightCacheInput,
  readInlineInsightCache,
  writeInlineInsightCache,
} from '@/services/inlineInsight/cache';
import { DEFAULT_INLINE_INSIGHT_SETTINGS } from '@/services/inlineInsight/types';

const input = new InlineInsightCacheInput(
  {
    ...DEFAULT_INLINE_INSIGHT_SETTINGS,
    provider: 'ollama',
    model: 'qwen2.5:7b',
    chatUrl: 'http://127.0.0.1:11434/v1/chat/completions',
    modelUrl: 'http://127.0.0.1:11434/v1/models',
  },
  [
    { role: 'system', content: 'Use zh-CN' },
    { role: 'user', content: 'Context:\nBefore\nSelected\nafter\n\nSelected text:\nepisteme' },
  ],
);

describe('Inline Insight cache', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('builds stable keys without storing raw context in the key', () => {
    const key = input.buildKey();

    expect(key).toBe(input.buildKey());
    expect(key).not.toContain('episteme');
    expect(key).not.toContain('Before\nSelected\nafter');
  });

  it('reads cached responses before TTL expiry', () => {
    const key = input.buildKey();

    writeInlineInsightCache(key, 'cached answer');

    expect(readInlineInsightCache(key)).toBe('cached answer');
  });

  it('does not write empty responses', () => {
    const key = input.buildKey();

    writeInlineInsightCache(key, '   \n');

    expect(localStorage.getItem(key)).toBeNull();
  });

  it('removes old empty responses when reading', () => {
    const key = input.buildKey();
    localStorage.setItem(key, '   ');

    expect(readInlineInsightCache(key)).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it('clears Inline Insight entries only', () => {
    const key = input.buildKey();
    writeInlineInsightCache(key, 'cached answer');
    localStorage.setItem('other', 'keep');

    clearInlineInsightCache();

    expect(localStorage.getItem(key)).toBeNull();
    expect(localStorage.getItem('other')).toBe('keep');
  });
});
