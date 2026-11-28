import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// Android's ICU ships without its Chinese dictionary, so Intl.Segmenter (like
// the WebView's own long-press) splits Chinese into single characters (#8018).
// jieba widens the character to its word there; everywhere else the platform
// segments Chinese itself and nothing changes.

const h = vi.hoisted(() => ({ jiebaReady: true }));
vi.mock('@/utils/jieba', async (importActual) => ({
  ...(await importActual<typeof import('@/utils/jieba')>()),
  isJiebaReady: () => h.jiebaReady,
}));

import { getWordRangeAt, widenToChineseWord } from '@/utils/sel';

// Intl.Segmenter as Android has it: one segment per Han character.
class AndroidSegmenter {
  segment(text: string) {
    return [...text].map((segment, index) => ({
      segment,
      index,
      isWordLike: /\p{Script=Han}/u.test(segment),
    }));
  }
}

const TEXT = '独立思考是一种重要的能力。';

const textNode = () => {
  const node = document.createTextNode(TEXT);
  document.body.appendChild(node);
  return node;
};

const charRange = (node: Text, char: string) => {
  const range = document.createRange();
  const start = TEXT.indexOf(char);
  range.setStart(node, start);
  range.setEnd(node, start + char.length);
  return range;
};

beforeEach(() => {
  h.jiebaReady = true;
  vi.stubGlobal('Intl', { ...Intl, Segmenter: AndroidSegmenter });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('widenToChineseWord', () => {
  test('widens a Chinese character to its word', () => {
    const node = textNode();
    expect(widenToChineseWord(charRange(node, '思'), 'zh')?.toString()).toBe('思考');
  });

  test('leaves a character that is a word by itself', () => {
    const node = textNode();
    expect(widenToChineseWord(charRange(node, '是'), 'zh')).toBeNull();
  });

  test('only in a Chinese book', () => {
    const node = textNode();
    expect(widenToChineseWord(charRange(node, '思'), 'ja')).toBeNull();
    expect(widenToChineseWord(charRange(node, '思'), undefined)).toBeNull();
  });

  test('only once jieba is loaded', () => {
    h.jiebaReady = false;
    const node = textNode();
    expect(widenToChineseWord(charRange(node, '思'), 'zh')).toBeNull();
  });

  test('not where Intl.Segmenter segments Chinese itself', () => {
    vi.unstubAllGlobals();
    const node = textNode();
    expect(widenToChineseWord(charRange(node, '思'), 'zh')).toBeNull();
  });
});

describe('getWordRangeAt in a Chinese book on Android', () => {
  // A caret between two characters belongs to the one before it.
  const afterSi = TEXT.indexOf('思') + 1;

  test('returns the word, not the character', () => {
    const node = textNode();
    expect(getWordRangeAt(node, afterSi, 'zh')?.toString()).toBe('思考');
  });

  test('keeps the character in a book of another language', () => {
    const node = textNode();
    expect(getWordRangeAt(node, afterSi)?.toString()).toBe('思');
  });
});
