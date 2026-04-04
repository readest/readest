import { describe, it, expect } from 'vitest';
import { genSSMLRaw, findSSMLMark, filterSSMLWithLang } from '@/utils/ssml';
import { TTSMark } from '@/services/tts/types';

const ssmlWithLang = (lang: string, body: string) =>
  `<speak xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}">${body}</speak>`;

const makeMark = (offset: number, name: string, text: string, language = 'en'): TTSMark => ({
  offset,
  name,
  text,
  language,
});

describe('genSSMLRaw', () => {
  it('should wrap text in speak tags with mark name="-1"', () => {
    const result = genSSMLRaw('Hello world');
    expect(result).toContain('<speak');
    expect(result).toContain('</speak>');
    expect(result).toContain('<mark name="-1"/>');
    expect(result).toContain('Hello world');
  });

  it('should include xmlns and xml:lang attributes', () => {
    const result = genSSMLRaw('test');
    expect(result).toContain('xmlns="http://www.w3.org/2001/10/synthesis"');
    expect(result).toContain('xml:lang="en"');
  });

  it('should place mark before the text content', () => {
    const result = genSSMLRaw('Some text');
    const markIndex = result.indexOf('<mark name="-1"/>');
    const textIndex = result.indexOf('Some text');
    expect(markIndex).toBeLessThan(textIndex);
  });
});

describe('findSSMLMark', () => {
  it('should return null for empty marks array', () => {
    const result = findSSMLMark(5, []);
    expect(result).toBeNull();
  });

  it('should return the only mark when charIndex >= its offset', () => {
    const marks = [makeMark(0, '0', 'Hello')];
    const result = findSSMLMark(3, marks);
    expect(result).toEqual(marks[0]);
  });

  it('should return null when charIndex < first mark offset', () => {
    const marks = [makeMark(10, '0', 'Hello')];
    const result = findSSMLMark(5, marks);
    expect(result).toBeNull();
  });

  it('should find correct mark via binary search with multiple marks', () => {
    const marks = [
      makeMark(0, '0', 'Hello '),
      makeMark(6, '1', 'world '),
      makeMark(12, '2', 'foo '),
      makeMark(16, '3', 'bar'),
    ];

    // charIndex 7 is in the "world " segment (offset 6)
    const result = findSSMLMark(7, marks);
    expect(result).toEqual(marks[1]);

    // charIndex 12 exactly at "foo " start (offset 12)
    const result2 = findSSMLMark(12, marks);
    expect(result2).toEqual(marks[2]);

    // charIndex 0 exactly at first mark
    const result3 = findSSMLMark(0, marks);
    expect(result3).toEqual(marks[0]);
  });

  it('should return last mark when charIndex is beyond all marks', () => {
    const marks = [
      makeMark(0, '0', 'Hello '),
      makeMark(6, '1', 'world '),
      makeMark(12, '2', 'end'),
    ];
    const result = findSSMLMark(100, marks);
    expect(result).toEqual(marks[2]);
  });
});

describe('filterSSMLWithLang', () => {
  it('should keep original when target matches main language', () => {
    const ssml = ssmlWithLang('en', '<mark name="0"/>Hello world');
    const result = filterSSMLWithLang(ssml, 'en');
    expect(result).toContain('Hello world');
  });

  it('should remove non-matching lang blocks when target matches main', () => {
    const ssml = ssmlWithLang(
      'en',
      '<mark name="0"/>Hello <lang xml:lang="fr"><mark name="1"/>Bonjour</lang> world',
    );
    const result = filterSSMLWithLang(ssml, 'en');
    expect(result).toContain('Hello');
    expect(result).toContain('world');
    expect(result).not.toContain('Bonjour');
    expect(result).not.toContain('<lang');
  });

  it('should keep matching lang blocks when target matches main language', () => {
    const ssml = ssmlWithLang(
      'en',
      '<mark name="0"/>Hello <lang xml:lang="en"><mark name="1"/>English block</lang> world',
    );
    const result = filterSSMLWithLang(ssml, 'en');
    expect(result).toContain('English block');
  });

  it('should extract matching lang blocks when target is different from main', () => {
    const ssml = ssmlWithLang(
      'en',
      '<mark name="0"/>Hello <lang xml:lang="fr"><mark name="1"/>Bonjour</lang> world',
    );
    const result = filterSSMLWithLang(ssml, 'fr');
    expect(result).toContain('Bonjour');
    expect(result).toContain('<speak');
    expect(result).toContain('</speak>');
    // Should not contain the English text outside lang blocks
    expect(result).not.toContain('Hello');
    expect(result).not.toContain('world');
  });

  it('should return original when no matching blocks found', () => {
    const ssml = ssmlWithLang(
      'en',
      '<mark name="0"/>Hello <lang xml:lang="fr"><mark name="1"/>Bonjour</lang>',
    );
    const result = filterSSMLWithLang(ssml, 'de');
    // "de" doesn't match main lang "en" and no <lang xml:lang="de"> blocks exist
    expect(result).toBe(ssml);
  });

  it('should handle multiple lang blocks and extract all matching ones', () => {
    const ssml = ssmlWithLang(
      'en',
      '<mark name="0"/>Hello <lang xml:lang="fr"><mark name="1"/>Bonjour</lang> and <lang xml:lang="fr"><mark name="2"/>Au revoir</lang>',
    );
    const result = filterSSMLWithLang(ssml, 'fr');
    expect(result).toContain('Bonjour');
    expect(result).toContain('Au revoir');
  });
});
