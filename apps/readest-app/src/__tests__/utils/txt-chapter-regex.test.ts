import { describe, it, expect } from 'vitest';
import { TxtToEpubConverter } from '@/utils/txt';

/**
 * Access private createChapterRegexps via a thin test subclass.
 */
class TestableConverter extends TxtToEpubConverter {
  getChapterRegexps(language: string): RegExp[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this as any).createChapterRegexps(language);
  }
}

function splitByRegexps(text: string, regexps: RegExp[]): string[] {
  for (const regex of regexps) {
    const parts = text.split(regex);
    const meaningful = parts.filter((p) => p && p.trim().length > 0);
    if (meaningful.length > 1) return parts;
  }
  return [];
}

describe('English chapter regexps', () => {
  const converter = new TestableConverter();

  it('should match "Chapter N" headings', () => {
    const text =
      'Intro text\nChapter 1 Getting Started\nContent here\nChapter 2 Next Topic\nMore content';
    const regexps = converter.getChapterRegexps('en');
    const parts = splitByRegexps(text, regexps);
    expect(parts.length).toBeGreaterThan(1);
  });

  it('should match preface keywords like Foreword and Preface', () => {
    const text =
      'Foreword\nSome foreword text\nPreface\nSome preface text\nChapter 1 Start\nContent';
    const regexps = converter.getChapterRegexps('en');
    const parts = splitByRegexps(text, regexps);
    expect(parts.length).toBeGreaterThan(3);
  });

  it('should match bare dotted-number headings like 1.1Title', () => {
    const text = [
      'Preface text here',
      '1Building Abstractions',
      'Chapter 1 content here',
      '1.1The Elements of Programming',
      'Section content here about elements',
      '1.1.1Expressions',
      'Details about expressions',
      '1.2Procedures and Processes',
      'More content about procedures',
    ].join('\n');
    const regexps = converter.getChapterRegexps('en');
    const parts = splitByRegexps(text, regexps);
    expect(parts.length).toBeGreaterThan(3);
  });

  it('should match dotted-number headings with space before title', () => {
    const text = [
      'Intro',
      '1.1 The Elements of Programming',
      'Content',
      '1.2 Procedures and Processes',
      'More content',
    ].join('\n');
    const regexps = converter.getChapterRegexps('en');
    const parts = splitByRegexps(text, regexps);
    expect(parts.length).toBeGreaterThan(1);
  });

  it('should not match bare numbers in code or data lines', () => {
    // Numbers like "12.7" or "314.159" within content should NOT be treated as headings
    const text = [
      '1.1The Elements of Programming',
      'The value is 12.7 and also 314.159',
      '62.8318',
      '1.2Naming and the Environment',
      'More content',
    ].join('\n');
    const regexps = converter.getChapterRegexps('en');
    const parts = splitByRegexps(text, regexps);
    // Should split on 1.1... and 1.2... but not on 12.7, 314.159, 62.8318
    const headings = parts.filter((p) => p && /^\d+\.\d/.test(p.trim()));
    for (const h of headings) {
      // Every matched heading should start with a dotted number followed by a letter
      expect(h.trim()).toMatch(/^\d+(\.\d+)*[A-Z]/);
    }
  });

  it('should match single-digit chapter heading like 1Title', () => {
    const text =
      '1Building Abstractions with Procedures\nContent\n2Building Abstractions with Data\nMore';
    const regexps = converter.getChapterRegexps('en');
    const parts = splitByRegexps(text, regexps);
    expect(parts.length).toBeGreaterThan(1);
  });

  it('should not match footnote-like lines with digit-space-lowercase', () => {
    // Lines like "1 The Lisp..." or "2 The two dialects..." are footnotes, not headings
    const text = [
      '1.1The Elements of Programming',
      'Some content here',
      '1 The Lisp 1 Programmers Manual appeared in 1960',
      '2 The two dialects in which most major Lisp programs were written',
      '3 One such special application was a breakthrough',
      '1.2Naming and the Environment',
      'More content',
    ].join('\n');
    const regexps = converter.getChapterRegexps('en');
    const parts = splitByRegexps(text, regexps);
    // Should split on 1.1... and 1.2... but NOT on "1 The Lisp...", "2 The two...", "3 One such..."
    const meaningful = parts.filter((p) => p && p.trim().length > 0);
    // With 2 headings we expect ~5 parts (pre, heading1, content, heading2, content)
    expect(meaningful.length).toBeLessThanOrEqual(5);
  });
});
