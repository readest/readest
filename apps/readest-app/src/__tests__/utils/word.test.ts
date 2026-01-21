import { describe, it, expect } from 'vitest';
import { getWordCount } from '../../utils/word';

describe('Word Limit Feature', () => {
  describe('getWordCount', () => {
    it('should count single word correctly', () => {
      expect(getWordCount('hello')).toBe(1);
    });

    it('should count multiple words correctly', () => {
      expect(getWordCount('hello world')).toBe(2);
      expect(getWordCount('the quick brown fox')).toBe(4);
    });

    it('should handle multiple spaces between words', () => {
      expect(getWordCount('hello    world')).toBe(2);
    });

    it('should handle leading and trailing spaces', () => {
      expect(getWordCount('  hello world  ')).toBe(2);
    });

    it('should handle newlines and tabs', () => {
      expect(getWordCount('hello\nworld')).toBe(2);
      expect(getWordCount('hello\tworld')).toBe(2);
      expect(getWordCount('hello\n\t  world')).toBe(2);
    });

    it('should return 0 for empty string', () => {
      expect(getWordCount('')).toBe(0);
    });

    it('should return 0 for whitespace only', () => {
      expect(getWordCount('   ')).toBe(0);
      expect(getWordCount('\n\t  ')).toBe(0);
    });

    it('should handle punctuation as part of words', () => {
      expect(getWordCount("don't")).toBe(1);
      expect(getWordCount('hello, world!')).toBe(2);
    });

    it('should count exactly 30 words', () => {
      const thirtyWords = Array(30).fill('word').join(' ');
      expect(getWordCount(thirtyWords)).toBe(30);
    });

    it('should count more than 30 words', () => {
      const thirtyOneWords = Array(31).fill('word').join(' ');
      expect(getWordCount(thirtyOneWords)).toBe(31);
    });

    it('should handle unicode characters', () => {
      expect(getWordCount('你好 世界')).toBe(2);
      expect(getWordCount('café résumé')).toBe(2);
      expect(getWordCount('🎉 hello 🎊 world')).toBe(4);
    });

    it('should handle numbers as words', () => {
      expect(getWordCount('1 2 3 4 5')).toBe(5);
      expect(getWordCount('chapter 1 section 2')).toBe(4);
    });
  });

  describe('Edge cases', () => {
    it('should handle very long words', () => {
      const longWord = 'a'.repeat(1000);
      expect(getWordCount(longWord)).toBe(1);
    });

    it('should handle mixed content with newlines', () => {
      const text = `Line one with words.
      Line two with more words.
      Line three.`;
      // "Line one with words." = 4, "Line two with more words." = 5, "Line three." = 2 = 11 total
      expect(getWordCount(text)).toBe(11);
    });
  });
});

describe('Case Sensitivity Matching', () => {
  // Helper function to simulate matching logic
  const matchText = (text: string, pattern: string, caseSensitive: boolean): boolean => {
    if (caseSensitive) {
      return text === pattern;
    }
    return text.toLowerCase() === pattern.toLowerCase();
  };

  describe('Case-Sensitive Mode', () => {
    it('should match exact case only', () => {
      expect(matchText('Where', 'Where', true)).toBe(true);
    });

    it('should not match different case', () => {
      expect(matchText('where', 'Where', true)).toBe(false);
      expect(matchText('WHERE', 'Where', true)).toBe(false);
      expect(matchText('wHeRe', 'Where', true)).toBe(false);
    });

    it('should handle all uppercase pattern', () => {
      expect(matchText('HELLO', 'HELLO', true)).toBe(true);
      expect(matchText('hello', 'HELLO', true)).toBe(false);
    });

    it('should handle all lowercase pattern', () => {
      expect(matchText('hello', 'hello', true)).toBe(true);
      expect(matchText('Hello', 'hello', true)).toBe(false);
    });
  });

  describe('Case-Insensitive Mode', () => {
    it('should match same case', () => {
      expect(matchText('where', 'where', false)).toBe(true);
    });

    it('should match different cases', () => {
      expect(matchText('where', 'Where', false)).toBe(true);
      expect(matchText('Where', 'where', false)).toBe(true);
      expect(matchText('WHERE', 'where', false)).toBe(true);
      expect(matchText('wHeRe', 'where', false)).toBe(true);
    });

    it('should match title case to lowercase', () => {
      expect(matchText('The', 'the', false)).toBe(true);
    });

    it('should match with mixed input', () => {
      expect(matchText('HeLLo', 'HELLO', false)).toBe(true);
      expect(matchText('HeLLo', 'hello', false)).toBe(true);
    });
  });

  describe('Real-world examples', () => {
    it('should handle "the" in different cases', () => {
      const pattern = 'the';

      // Case-insensitive (default behavior)
      expect(matchText('The', pattern, false)).toBe(true);
      expect(matchText('the', pattern, false)).toBe(true);
      expect(matchText('THE', pattern, false)).toBe(true);

      // Case-sensitive
      expect(matchText('The', pattern, true)).toBe(false);
      expect(matchText('the', pattern, true)).toBe(true);
      expect(matchText('THE', pattern, true)).toBe(false);
    });

    it('should handle proper nouns correctly when case-sensitive', () => {
      const pattern = 'John';

      // Case-sensitive - only exact match
      expect(matchText('John', pattern, true)).toBe(true);
      expect(matchText('john', pattern, true)).toBe(false);
      expect(matchText('JOHN', pattern, true)).toBe(false);
    });
  });
});
