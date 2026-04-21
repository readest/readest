import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildInlineInsightCacheKey,
  clearInlineInsightCache,
  readInlineInsightCache,
  writeInlineInsightCache,
} from '@/services/inlineInsight/cache';

const input = {
  provider: 'ollama',
  baseUrl: 'http://127.0.0.1:11434',
  model: 'qwen2.5:7b',
  questionDirections: [],
  targetLanguage: 'zh-CN',
  selectedText: 'episteme',
  context: 'Before\nSelected\nafter',
};

describe('Inline Insight cache', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('builds stable keys without storing raw context in the key', () => {
    const key = buildInlineInsightCacheKey(input);

    expect(key).toBe(buildInlineInsightCacheKey(input));
    expect(key).not.toContain(input.selectedText);
    expect(key).not.toContain(input.context);
  });

  it('reads cached responses before TTL expiry', () => {
    const key = buildInlineInsightCacheKey(input);

    writeInlineInsightCache(key, 'cached answer');

    expect(readInlineInsightCache(key, 60)).toBe('cached answer');
  });

  it('does not write empty responses', () => {
    const key = buildInlineInsightCacheKey(input);

    writeInlineInsightCache(key, '   \n');

    expect(localStorage.getItem(key)).toBeNull();
  });

  it('removes old empty responses when reading', () => {
    const key = buildInlineInsightCacheKey(input);
    localStorage.setItem(key, JSON.stringify({ createdAt: Date.now(), text: '   ' }));

    expect(readInlineInsightCache(key, 60)).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it('expires old responses', () => {
    const key = buildInlineInsightCacheKey(input);
    localStorage.setItem(
      key,
      JSON.stringify({ createdAt: Date.now() - 2 * 60 * 1000, text: 'old answer' }),
    );

    expect(readInlineInsightCache(key, 1)).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it('clears Inline Insight entries only', () => {
    const key = buildInlineInsightCacheKey(input);
    writeInlineInsightCache(key, 'cached answer');
    localStorage.setItem('other', 'keep');

    clearInlineInsightCache();

    expect(localStorage.getItem(key)).toBeNull();
    expect(localStorage.getItem('other')).toBe('keep');
  });
});
