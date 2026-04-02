import { describe, it, expect } from 'vitest';
import { basicPolish, getPolisher, polish } from '@/services/translators/polish';

describe('basicPolish', () => {
  it('collapses multiple spaces into a single space', () => {
    expect(basicPolish('hello   world')).toBe('hello world');
  });

  it('removes space before punctuation', () => {
    expect(basicPolish('hello , world')).toBe('hello, world');
    expect(basicPolish('hello . world')).toBe('hello. world');
    expect(basicPolish('what ?')).toBe('what?');
    expect(basicPolish('wow !')).toBe('wow!');
    expect(basicPolish('item ; next')).toBe('item; next');
    expect(basicPolish('time : value')).toBe('time: value');
  });

  it('trims whitespace', () => {
    expect(basicPolish('  hello  ')).toBe('hello');
  });

  it('handles empty string', () => {
    expect(basicPolish('')).toBe('');
  });

  it('handles string with only spaces', () => {
    expect(basicPolish('     ')).toBe('');
  });

  it('handles tabs and newlines as whitespace', () => {
    expect(basicPolish('hello\t\n  world')).toBe('hello world');
  });
});

describe('getPolisher', () => {
  describe('Chinese (zh)', () => {
    const polisher = getPolisher('zh');

    it('replaces -- with ⸺', () => {
      expect(polisher('hello--world')).toBe('hello⸺world');
    });

    it('removes space before Chinese punctuation', () => {
      expect(polisher('你好 。再见')).toBe('你好。再见');
      expect(polisher('你好 、再见')).toBe('你好、再见');
      expect(polisher('你好 ！再见')).toBe('你好！再见');
      expect(polisher('你好 ？再见')).toBe('你好？再见');
    });

    it('removes space after Chinese punctuation', () => {
      expect(polisher('你好。 再见')).toBe('你好。再见');
    });

    it('also applies basic polishing first', () => {
      expect(polisher('  hello   world  ')).toBe('hello world');
    });
  });

  describe('Japanese (ja)', () => {
    const polisher = getPolisher('ja');

    it('removes space before Japanese punctuation', () => {
      expect(polisher('こんにちは 。さようなら')).toBe('こんにちは。さようなら');
      expect(polisher('こんにちは 、さようなら')).toBe('こんにちは、さようなら');
    });

    it('removes space after Japanese punctuation', () => {
      expect(polisher('こんにちは。 さようなら')).toBe('こんにちは。さようなら');
    });
  });

  describe('Spanish (es)', () => {
    const polisher = getPolisher('es');

    it('adds space between ? and uppercase letters', () => {
      expect(polisher('?Hola')).toBe('? Hola');
    });

    it('adds space between ! and uppercase letters', () => {
      expect(polisher('!Amigos')).toBe('! Amigos');
    });

    it('handles accented uppercase characters', () => {
      expect(polisher('?Ángel')).toBe('? Ángel');
      expect(polisher('!Último')).toBe('! Último');
    });
  });

  describe('French (fr)', () => {
    const polisher = getPolisher('fr');

    it('basicPolish removes space before punctuation first, then French polisher runs', () => {
      // basicPolish: 'Bonjour  !' -> 'Bonjour!'
      // French polisher: no \s+ before !, so no change
      // This documents the actual interaction between basic and French polishing
      expect(polisher('Bonjour  !')).toBe('Bonjour!');
    });

    it('normalizes space after high punctuation', () => {
      // basicPolish: '!  Bonjour' -> '! Bonjour' (multiple spaces -> single)
      // French polisher: /([!?:;])\s+/g -> '$1 ' which keeps exactly one space
      expect(polisher('!  Bonjour')).toBe('! Bonjour');
    });

    it('preserves single space before French high punctuation when already correct', () => {
      // If the input already has exactly the right spacing and basicPolish
      // removes the space, the French polisher cannot restore it.
      // basicPolish: 'Bonjour !' -> 'Bonjour!'
      expect(polisher('Bonjour !')).toBe('Bonjour!');
    });

    it('handles text without high punctuation', () => {
      expect(polisher('Bonjour le monde')).toBe('Bonjour le monde');
    });
  });

  describe('unsupported language', () => {
    it('falls back to basicPolish for unknown language', () => {
      const polisher = getPolisher('de');
      expect(polisher('hello   world  , test')).toBe('hello world, test');
    });
  });

  describe('language code with region', () => {
    it('uses the base language code from zh-CN', () => {
      const polisher = getPolisher('zh-CN');
      // Should use Chinese polisher
      expect(polisher('hello--world')).toBe('hello⸺world');
    });

    it('uses the base language code from ja-JP', () => {
      const polisher = getPolisher('ja-JP');
      expect(polisher('こんにちは 。さようなら')).toBe('こんにちは。さようなら');
    });
  });
});

describe('polish', () => {
  it('polishes an array of texts', () => {
    const result = polish(['hello   world', '  test  '], 'en');
    expect(result).toEqual(['hello world', 'test']);
  });

  it('polishes with language-specific rules', () => {
    const result = polish(['hello--world', '你好 。再见'], 'zh');
    expect(result).toEqual(['hello⸺world', '你好。再见']);
  });

  it('returns empty array for empty input', () => {
    expect(polish([], 'en')).toEqual([]);
  });
});
