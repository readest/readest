import { describe, it, expect } from 'vitest';
import { parseSSMLMarks, parseSSMLLang } from '@/utils/ssml';

// SSML with xml:lang on speak element (typical output from TTS with lang)
const ssmlWithLang = (lang: string, body: string) =>
  `<speak xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}">${body}</speak>`;

// SSML without xml:lang on speak element (output from TTS when document has no lang)
const ssmlNoLang = (body: string) =>
  `<speak xmlns="http://www.w3.org/2001/10/synthesis">${body}</speak>`;

describe('parseSSMLLang', () => {
  it('should extract lang from xml:lang attribute', () => {
    const ssml = ssmlWithLang('en', '<mark name="0"/>Hello');
    expect(parseSSMLLang(ssml)).toBe('en');
  });

  it('should normalize lang case (lowercase-UPPERCASE)', () => {
    const ssml = ssmlWithLang('en-us', '<mark name="0"/>Hello');
    expect(parseSSMLLang(ssml)).toBe('en-US');
  });

  it('should default to en when no xml:lang is present', () => {
    const ssml = ssmlNoLang('<mark name="0"/>Hello');
    expect(parseSSMLLang(ssml)).toBe('en');
  });

  it('should use primaryLang when no xml:lang and primaryLang differs from en', () => {
    const ssml = ssmlNoLang('<mark name="0"/>Bonjour');
    expect(parseSSMLLang(ssml, 'fr')).toBe('fr');
  });

  it('should use primaryLang when xml:lang is en but primaryLang differs', () => {
    const ssml = ssmlWithLang('en', '<mark name="0"/>Hola mundo');
    expect(parseSSMLLang(ssml, 'es')).toBe('es');
  });

  it('should keep document lang when it matches primaryLang', () => {
    const ssml = ssmlWithLang('fr', '<mark name="0"/>Bonjour');
    expect(parseSSMLLang(ssml, 'fr')).toBe('fr');
  });

  it('should keep non-en document lang even when primaryLang is different', () => {
    const ssml = ssmlWithLang('de', '<mark name="0"/>Hallo Welt');
    expect(parseSSMLLang(ssml, 'fr')).toBe('de');
  });

  it('should default to en when no xml:lang and no primaryLang', () => {
    const ssml = ssmlNoLang('<mark name="0"/>Hello');
    expect(parseSSMLLang(ssml)).toBe('en');
  });

  it('should infer CJK lang from script when lang is en', () => {
    const ssml = ssmlNoLang('<mark name="0"/>こんにちは');
    expect(parseSSMLLang(ssml)).toBe('ja');
  });

  it('should infer Chinese from script when no lang', () => {
    const ssml = ssmlNoLang('<mark name="0"/>你好世界');
    expect(parseSSMLLang(ssml)).toBe('zh');
  });

  it('should infer Korean from script when no lang', () => {
    const ssml = ssmlNoLang('<mark name="0"/>안녕하세요');
    expect(parseSSMLLang(ssml)).toBe('ko');
  });
});

describe('parseSSMLMarks', () => {
  describe('with lang in SSML', () => {
    it('should parse marks from SSML with lang', () => {
      const ssml = ssmlWithLang('en', '<mark name="0"/>Hello <mark name="1"/>world');
      const { plainText, marks } = parseSSMLMarks(ssml);

      expect(plainText).toBe('Hello world');
      expect(marks).toHaveLength(2);
      expect(marks[0]).toMatchObject({ name: '0', text: 'Hello ', language: 'en' });
      expect(marks[1]).toMatchObject({ name: '1', text: 'world', language: 'en' });
    });

    it('should assign correct offsets', () => {
      const ssml = ssmlWithLang('en', '<mark name="0"/>First <mark name="1"/>Second');
      const { marks } = parseSSMLMarks(ssml);

      expect(marks[0]).toMatchObject({ offset: 0, text: 'First ' });
      expect(marks[1]).toMatchObject({ offset: 6, text: 'Second' });
    });

    it('should handle lang blocks within SSML', () => {
      const ssml = ssmlWithLang(
        'en',
        '<mark name="0"/>Hello <lang xml:lang="fr"><mark name="1"/>Bonjour</lang>',
      );
      const { marks } = parseSSMLMarks(ssml);

      expect(marks[0]).toMatchObject({ text: 'Hello ', language: 'en' });
      expect(marks[1]).toMatchObject({ text: 'Bonjour', language: 'fr' });
    });

    it('should restore lang after closing lang block', () => {
      const ssml = ssmlWithLang(
        'en',
        '<mark name="0"/>Hello <lang xml:lang="de"><mark name="1"/>Welt</lang> <mark name="2"/>world',
      );
      const { marks } = parseSSMLMarks(ssml);

      expect(marks[0]!.language).toBe('en');
      expect(marks[1]!.language).toBe('de');
      expect(marks[2]!.language).toBe('en');
    });
  });

  describe('without lang in SSML (no lang document)', () => {
    it('should fall back to en when no lang and no primaryLang', () => {
      const ssml = ssmlNoLang('<mark name="0"/>Hello <mark name="1"/>world');
      const { plainText, marks } = parseSSMLMarks(ssml);

      expect(plainText).toBe('Hello world');
      expect(marks).toHaveLength(2);
      expect(marks[0]!.language).toBe('en');
      expect(marks[1]!.language).toBe('en');
    });

    it('should use primaryLang when no lang in SSML', () => {
      const ssml = ssmlNoLang('<mark name="0"/>Bonjour <mark name="1"/>monde');
      const { marks } = parseSSMLMarks(ssml, 'fr');

      expect(marks[0]!.language).toBe('fr');
      expect(marks[1]!.language).toBe('fr');
    });

    it('should use primaryLang with region code when no lang in SSML', () => {
      const ssml = ssmlNoLang('<mark name="0"/>Hola <mark name="1"/>mundo');
      const { marks } = parseSSMLMarks(ssml, 'es-MX');

      expect(marks[0]!.language).toBe('es');
      expect(marks[1]!.language).toBe('es');
    });

    it('should infer CJK language from text when no lang and no primaryLang', () => {
      const ssml = ssmlNoLang('<mark name="0"/>こんにちは');
      const { marks } = parseSSMLMarks(ssml);

      expect(marks[0]!.language).toBe('ja');
    });

    it('should infer Chinese from text when no lang and no primaryLang', () => {
      const ssml = ssmlNoLang('<mark name="0"/>你好世界');
      const { marks } = parseSSMLMarks(ssml);

      expect(marks[0]!.language).toBe('zh');
    });

    it('should infer Korean from text when no lang and no primaryLang', () => {
      const ssml = ssmlNoLang('<mark name="0"/>안녕하세요');
      const { marks } = parseSSMLMarks(ssml);

      expect(marks[0]!.language).toBe('ko');
    });
  });

  describe('edge cases', () => {
    it('should skip punctuation-only marks', () => {
      const ssml = ssmlWithLang(
        'en',
        '<mark name="0"/>Hello <mark name="1"/>... <mark name="2"/>world',
      );
      const { marks } = parseSSMLMarks(ssml);

      const names = marks.map((m) => m.name);
      expect(names).toContain('0');
      expect(names).not.toContain('1');
      expect(names).toContain('2');
    });

    it('should handle empty SSML body', () => {
      const ssml = ssmlWithLang('en', '');
      const { plainText, marks } = parseSSMLMarks(ssml);

      expect(plainText).toBe('');
      expect(marks).toHaveLength(0);
    });

    it('should handle SSML with only whitespace text', () => {
      const ssml = ssmlWithLang('en', '<mark name="0"/>   ');
      const { marks } = parseSSMLMarks(ssml);

      expect(marks).toHaveLength(0);
    });

    it('should handle emphasis tags without losing text', () => {
      const ssml = ssmlWithLang('en', '<mark name="0"/><emphasis>Important</emphasis> text');
      const { plainText } = parseSSMLMarks(ssml);

      expect(plainText).toContain('Important');
      expect(plainText).toContain('text');
    });
  });
});
