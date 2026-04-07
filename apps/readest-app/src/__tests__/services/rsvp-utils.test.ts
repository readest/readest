import { describe, test, expect } from 'vitest';
import {
  isCJK,
  containsCJK,
  isCJKPunctuation,
  getSegmenterLocale,
  segmentCJKText,
  splitTextIntoWords,
  getHyphenParts,
} from '@/services/rsvp/utils';

describe('rsvp/utils', () => {
  describe('isCJK', () => {
    test('returns true for CJK Unified Ideographs', () => {
      expect(isCJK('\u4e00')).toBe(true); // first CJK character
      expect(isCJK('\u9fff')).toBe(true); // last CJK character
      expect(isCJK('\u5f00')).toBe(true); // 开
    });

    test('returns true for Hiragana', () => {
      expect(isCJK('\u3042')).toBe(true); // あ
    });

    test('returns true for Katakana', () => {
      expect(isCJK('\u30A2')).toBe(true); // ア
    });

    test('returns true for Hangul', () => {
      expect(isCJK('\uAC00')).toBe(true); // 가
    });

    test('returns true for CJK Extension A', () => {
      expect(isCJK('\u3400')).toBe(true);
    });

    test('returns true for CJK Compatibility Ideographs', () => {
      expect(isCJK('\uF900')).toBe(true);
    });

    test('returns false for Latin characters', () => {
      expect(isCJK('a')).toBe(false);
      expect(isCJK('Z')).toBe(false);
    });

    test('returns false for digits', () => {
      expect(isCJK('1')).toBe(false);
    });

    test('returns false for spaces', () => {
      expect(isCJK(' ')).toBe(false);
    });
  });

  describe('containsCJK', () => {
    test('returns true for text with CJK characters', () => {
      expect(containsCJK('Hello 你好')).toBe(true);
    });

    test('returns true for pure CJK text', () => {
      expect(containsCJK('你好世界')).toBe(true);
    });

    test('returns false for pure Latin text', () => {
      expect(containsCJK('Hello World')).toBe(false);
    });

    test('returns false for empty string', () => {
      expect(containsCJK('')).toBe(false);
    });

    test('returns true for Japanese hiragana', () => {
      expect(containsCJK('こんにちは')).toBe(true);
    });

    test('returns true for Korean', () => {
      expect(containsCJK('안녕하세요')).toBe(true);
    });
  });

  describe('isCJKPunctuation', () => {
    test('returns true for Chinese period', () => {
      expect(isCJKPunctuation('。')).toBe(true);
    });

    test('returns true for Chinese comma', () => {
      expect(isCJKPunctuation('，')).toBe(true);
    });

    test('returns true for full-width exclamation', () => {
      expect(isCJKPunctuation('！')).toBe(true);
    });

    test('returns true for full-width question mark', () => {
      expect(isCJKPunctuation('？')).toBe(true);
    });

    test('returns true for brackets', () => {
      expect(isCJKPunctuation('【')).toBe(true);
      expect(isCJKPunctuation('】')).toBe(true);
      expect(isCJKPunctuation('「')).toBe(true);
      expect(isCJKPunctuation('」')).toBe(true);
    });

    test('returns true for ellipsis', () => {
      expect(isCJKPunctuation('…')).toBe(true);
    });

    test('returns false for standard Latin comma', () => {
      expect(isCJKPunctuation(',')).toBe(false);
    });

    test('returns false for Latin period', () => {
      expect(isCJKPunctuation('.')).toBe(false);
    });

    test('returns false for a letter', () => {
      expect(isCJKPunctuation('A')).toBe(false);
    });
  });

  describe('getSegmenterLocale', () => {
    test('returns ja for Japanese hiragana text', () => {
      expect(getSegmenterLocale('こんにちは')).toBe('ja');
    });

    test('returns ja for Katakana text', () => {
      expect(getSegmenterLocale('アイウ')).toBe('ja');
    });

    test('returns ko for Korean text', () => {
      expect(getSegmenterLocale('안녕하세요')).toBe('ko');
    });

    test('returns zh for Chinese text', () => {
      expect(getSegmenterLocale('你好世界')).toBe('zh');
    });

    test('returns null for pure Latin text', () => {
      expect(getSegmenterLocale('Hello World')).toBeNull();
    });

    test('returns null for empty string', () => {
      expect(getSegmenterLocale('')).toBeNull();
    });

    test('detects first CJK script in mixed text', () => {
      // Japanese hiragana appears first
      expect(getSegmenterLocale('あ你好')).toBe('ja');
    });
  });

  describe('segmentCJKText', () => {
    test('segments Chinese text into words', () => {
      const words = segmentCJKText('你好世界');
      expect(words.length).toBeGreaterThan(0);
      expect(words.join('')).toContain('你好');
    });

    test('segments Japanese text', () => {
      const words = segmentCJKText('こんにちは');
      expect(words.length).toBeGreaterThan(0);
    });

    test('handles text with punctuation', () => {
      const words = segmentCJKText('你好。世界！');
      expect(words.length).toBeGreaterThan(0);
    });

    test('handles empty text', () => {
      const words = segmentCJKText('');
      expect(words).toEqual([]);
    });

    test('handles single character', () => {
      const words = segmentCJKText('你');
      expect(words.length).toBeGreaterThanOrEqual(1);
    });

    test('attaches trailing CJK punctuation', () => {
      const words = segmentCJKText('你好！');
      // The punctuation should be attached to a word
      const hasWordWithPunct = words.some((w) => w.includes('！'));
      expect(hasWordWithPunct).toBe(true);
    });
  });

  describe('splitTextIntoWords', () => {
    test('splits English text by spaces', () => {
      const words = splitTextIntoWords('Hello World');
      expect(words).toEqual(['Hello', 'World']);
    });

    test('splits multi-word English text', () => {
      const words = splitTextIntoWords('The quick brown fox');
      expect(words).toEqual(['The', 'quick', 'brown', 'fox']);
    });

    test('filters empty words', () => {
      const words = splitTextIntoWords('  Hello   World  ');
      expect(words.every((w) => w.trim().length > 0)).toBe(true);
    });

    test('handles CJK text', () => {
      const words = splitTextIntoWords('你好世界');
      expect(words.length).toBeGreaterThan(0);
    });

    test('handles mixed CJK and Latin text', () => {
      const words = splitTextIntoWords('Hello 你好 World');
      expect(words.length).toBeGreaterThan(0);
      // Should contain both CJK and Latin segments
    });

    test('handles empty string', () => {
      const words = splitTextIntoWords('');
      expect(words).toEqual([]);
    });

    test('handles CJK text with punctuation', () => {
      const words = splitTextIntoWords('你好。世界！');
      expect(words.length).toBeGreaterThan(0);
    });

    test('handles CJK followed immediately by non-CJK', () => {
      const words = splitTextIntoWords('你好Hello');
      expect(words.length).toBeGreaterThanOrEqual(1);
    });

    test('handles standalone CJK punctuation at start', () => {
      const words = splitTextIntoWords('。Hello');
      expect(words.length).toBeGreaterThan(0);
    });

    test('handles non-CJK text followed by CJK punctuation', () => {
      const words = splitTextIntoWords('Hello。');
      expect(words.length).toBeGreaterThan(0);
    });

    test('handles whitespace between CJK segments', () => {
      const words = splitTextIntoWords('你好 世界');
      expect(words.length).toBeGreaterThan(0);
    });
  });

  describe('getHyphenParts', () => {
    test('splits a hyphenated word into two parts with trailing hyphen on first', () => {
      expect(getHyphenParts('well-known')).toEqual(['well-', 'known']);
    });

    test('splits multiple letter-hyphens keeping trailing hyphen on each non-last part', () => {
      expect(getHyphenParts('one-two-three')).toEqual(['one-', 'two-', 'three']);
    });

    test('returns word unchanged when no letter-hyphen-letter pattern', () => {
      expect(getHyphenParts('hello')).toEqual(['hello']);
    });

    test('returns double-hyphen unchanged (em-dash style)', () => {
      expect(getHyphenParts('--')).toEqual(['--']);
    });

    test('returns lone hyphen unchanged', () => {
      expect(getHyphenParts('-')).toEqual(['-']);
    });

    test('returns consecutive-hyphen word unchanged', () => {
      expect(getHyphenParts('foo--bar')).toEqual(['foo--bar']);
    });

    test('returns leading-hyphen word unchanged', () => {
      expect(getHyphenParts('-word')).toEqual(['-word']);
    });

    test('returns trailing-hyphen word unchanged', () => {
      expect(getHyphenParts('word-')).toEqual(['word-']);
    });

    test('splits on ellipsis between letters with trailing ellipsis on non-last parts', () => {
      expect(getHyphenParts('a...b')).toEqual(['a...', 'b']);
    });

    test('splits mixed hyphens and ellipses preserving each delimiter', () => {
      expect(getHyphenParts('foo-bar...baz')).toEqual(['foo-', 'bar...', 'baz']);
    });

    test('returns ellipsis-only unchanged', () => {
      expect(getHyphenParts('...')).toEqual(['...']);
    });
  });
});
