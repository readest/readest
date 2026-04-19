import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildSmartAskCacheKey,
  clearSmartAskCache,
  readSmartAskCache,
  writeSmartAskCache,
} from '@/services/smartAsk/cache';

const input = {
  provider: 'ollama',
  baseUrl: 'http://127.0.0.1:11434',
  model: 'qwen2.5:7b',
  questionDirections: [],
  uiLanguage: 'zh-CN',
  selectedText: 'episteme',
  context: 'Before\nSelected\nafter',
};

describe('SmartAsk cache', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('builds stable keys without storing raw context in the key', () => {
    const key = buildSmartAskCacheKey(input);

    expect(key).toBe(buildSmartAskCacheKey(input));
    expect(key).not.toContain(input.selectedText);
    expect(key).not.toContain(input.context);
  });

  it('reads cached responses before TTL expiry', () => {
    const key = buildSmartAskCacheKey(input);

    writeSmartAskCache(key, 'cached answer');

    expect(readSmartAskCache(key, 60)).toBe('cached answer');
  });

  it('does not write empty responses', () => {
    const key = buildSmartAskCacheKey(input);

    writeSmartAskCache(key, '   \n');

    expect(localStorage.getItem(key)).toBeNull();
  });

  it('removes old empty responses when reading', () => {
    const key = buildSmartAskCacheKey(input);
    localStorage.setItem(key, JSON.stringify({ createdAt: Date.now(), text: '   ' }));

    expect(readSmartAskCache(key, 60)).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it('expires old responses', () => {
    const key = buildSmartAskCacheKey(input);
    localStorage.setItem(
      key,
      JSON.stringify({ createdAt: Date.now() - 2 * 60 * 1000, text: 'old answer' }),
    );

    expect(readSmartAskCache(key, 1)).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it('clears SmartAsk entries only', () => {
    const key = buildSmartAskCacheKey(input);
    writeSmartAskCache(key, 'cached answer');
    localStorage.setItem('other', 'keep');

    clearSmartAskCache();

    expect(localStorage.getItem(key)).toBeNull();
    expect(localStorage.getItem('other')).toBe('keep');
  });
});
