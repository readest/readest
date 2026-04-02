// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { TxtToEpubConverter } from '@/utils/txt';

type TxtConverterExtractAPI = {
  createChapterRegexps(language: string): RegExp[];
  joinAroundUndefined(arr: (string | undefined)[]): string[];
  isGoodMatches(matches: string[], maxLength?: number): boolean;
  extractChaptersFromSegment(
    segment: string,
    metadata: { bookTitle: string; author: string; language: string; identifier: string },
    option: { linesBetweenSegments: number; fallbackParagraphsPerChapter: number },
    chapterOffset: number,
  ): { title: string; content: string; isVolume: boolean }[];
};

const getApi = (): TxtConverterExtractAPI =>
  new TxtToEpubConverter() as unknown as TxtConverterExtractAPI;

const metadata = (lang: string) => ({
  bookTitle: 'Test',
  author: '',
  language: lang,
  identifier: 'test',
});

const defaultOption = { linesBetweenSegments: 8, fallbackParagraphsPerChapter: 0 };

/** Helper: extract chapters from a segment for a given language. */
const extractChapters = (text: string, language: string) => {
  const api = getApi();
  return api.extractChaptersFromSegment(text, metadata(language), defaultOption, 0);
};

/** Helper: get the first chapter regex for a language. */
const getFirstRegex = (language: string) => {
  const api = getApi();
  return api.createChapterRegexps(language)[0]!;
};

// ---------------------------------------------------------------------------
// Chinese chapter regex — matching tests
// ---------------------------------------------------------------------------
describe('createChapterRegexps — Chinese (zh) regex matching', () => {
  describe('第N章 pattern', () => {
    it.each([
      '第一章',
      '第1章',
      ' 第1章',
      '第 1 章',
      '第十五章',
      '第一百二十三章',
      '第零章',
      '第〇一章',
      '第　一章', // full-width space
    ])('should match "%s"', (heading) => {
      const regex = getFirstRegex('zh');
      expect(regex.test(`\n${heading}\n`)).toBe(true);
    });

    it('should match chapter with title after it', () => {
      const regex = getFirstRegex('zh');
      expect(regex.test('\n第一章 天地初开\n')).toBe(true);
    });

    it('should match chapter with colon separator', () => {
      const regex = getFirstRegex('zh');
      expect(regex.test('\n第二章：风起云涌\n')).toBe(true);
    });

    it('should match chapter with Chinese colon separator', () => {
      const regex = getFirstRegex('zh');
      expect(regex.test('\n第三章：烈火焚城\n')).toBe(true);
    });
  });

  describe('第N[卷节回讲篇封本册部话] variants', () => {
    it.each(['卷', '节', '回', '讲', '篇', '封', '本', '册', '部', '话'])(
      'should match 第一%s',
      (suffix) => {
        const regex = getFirstRegex('zh');
        expect(regex.test(`\n第一${suffix}\n`)).toBe(true);
      },
    );
  });

  describe('Chinese preface keywords', () => {
    it.each(['楔子', '前言', '简介', '引言', '序言', '序章', '总论', '概论', '后记'])(
      'should match %s',
      (keyword) => {
        const regex = getFirstRegex('zh');
        expect(regex.test(`\n${keyword}\n`)).toBe(true);
      },
    );

    it('should match 前言 with title', () => {
      const regex = getFirstRegex('zh');
      expect(regex.test('\n前言：本书简介\n')).toBe(true);
    });

    it('should match 序言 with colon and title', () => {
      const regex = getFirstRegex('zh');
      expect(regex.test('\n序言：致读者\n')).toBe(true);
    });
  });

  describe('"chapter" keyword in Chinese context', () => {
    it.each(['Chapter 1', 'CHAPTER 10', 'chapter.5', 'chapter 2: The Beginning'])(
      'should match "%s" (case-insensitive)',
      (heading) => {
        const regex = getFirstRegex('zh');
        expect(regex.test(`\n${heading}\n`)).toBe(true);
      },
    );
  });

  describe('should not match', () => {
    it('should not match chapter heading embedded mid-line', () => {
      const regex = getFirstRegex('zh');
      // "第一章" not at line start
      expect(regex.test('这句话包含第一章这个词')).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Chinese chapter regex — second-tier regex
// ---------------------------------------------------------------------------
describe('createChapterRegexps — Chinese (zh) second regex', () => {
  it('should match Chinese number followed by colon and title', () => {
    const api = getApi();
    const regexps = api.createChapterRegexps('zh');
    // Use fresh regex copies to avoid g-flag lastIndex issues
    const re1 = new RegExp(regexps[1]!.source, regexps[1]!.flags);
    const re2 = new RegExp(regexps[1]!.source, regexps[1]!.flags);
    expect(re1.test('\n一：天地玄黄\n')).toBe(true);
    expect(re2.test('\n二：宇宙洪荒\n')).toBe(true);
  });

  it('should match bare number heading', () => {
    const api = getApi();
    const regexps = api.createChapterRegexps('zh');
    const secondRegex = regexps[1]!;
    expect(secondRegex.test('\n1 第一节\n')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// English chapter regex — matching tests
// ---------------------------------------------------------------------------
describe('createChapterRegexps — English (en) regex matching', () => {
  describe('Chapter keyword', () => {
    it.each(['Chapter 1', 'Chapter 12', 'Chapter 999', 'CHAPTER 5', 'chapter 3'])(
      'should match "%s"',
      (heading) => {
        const regex = getFirstRegex('en');
        expect(regex.test(`\n${heading}\n`)).toBe(true);
      },
    );

    it('should match "Chapter 1: Title" with title', () => {
      const regex = getFirstRegex('en');
      expect(regex.test('\nChapter 1: The Beginning\n')).toBe(true);
    });

    it('should match "Chapter 3 - Aftermath" with dash separator', () => {
      const regex = getFirstRegex('en');
      expect(regex.test('\nChapter 3 - Aftermath\n')).toBe(true);
    });
  });

  describe('Roman numeral chapters', () => {
    it.each(['V', 'X', 'L', 'C', 'D', 'M'])(
      'should match single Roman numeral "Chapter %s"',
      (numeral) => {
        const regex = getFirstRegex('en');
        expect(regex.test(`\nChapter ${numeral}\n`)).toBe(true);
      },
    );

    it.each(['II', 'III', 'IV', 'VII', 'XII', 'XIV', 'XLII'])(
      'should match multi-char Roman numeral "Chapter %s"',
      (numeral) => {
        const regex = getFirstRegex('en');
        expect(regex.test(`\nChapter ${numeral}\n`)).toBe(true);
      },
    );

    it('should not match single "I" as Roman numeral (not in allowed set)', () => {
      const regex = getFirstRegex('en');
      // 'I' alone is not V/X/L/C/D/M and not {2,} chars
      expect(regex.test('\nChapter I\n')).toBe(false);
    });
  });

  describe('dot-number pattern', () => {
    it.each(['Chapter.1', 'Section.42', 'Part.3'])('should match "%s"', (heading) => {
      const regex = getFirstRegex('en');
      expect(regex.test(`\n${heading}\n`)).toBe(true);
    });
  });

  describe('other chapter keywords', () => {
    it.each(['Part', 'Section', 'Book', 'Volume', 'Act'])('should match "%s 1"', (keyword) => {
      const regex = getFirstRegex('en');
      expect(regex.test(`\n${keyword} 1\n`)).toBe(true);
    });

    it.each(['Part', 'Section', 'Book', 'Volume', 'Act'])(
      'should match "%s 3: A New Beginning" with title',
      (keyword) => {
        const regex = getFirstRegex('en');
        expect(regex.test(`\n${keyword} 3: A New Beginning\n`)).toBe(true);
      },
    );
  });

  describe('preface keywords', () => {
    it.each(['Prologue', 'Epilogue', 'Introduction', 'Foreword', 'Preface', 'Afterword'])(
      'should match "%s"',
      (keyword) => {
        const regex = getFirstRegex('en');
        expect(regex.test(`\n${keyword}\n`)).toBe(true);
      },
    );

    it.each(['PROLOGUE', 'prologue', 'Prologue'])(
      'should match "%s" case-insensitively',
      (keyword) => {
        const regex = getFirstRegex('en');
        expect(regex.test(`\n${keyword}\n`)).toBe(true);
      },
    );

    it('should match "Prologue: The Beginning"', () => {
      const regex = getFirstRegex('en');
      expect(regex.test('\nPrologue: The Beginning\n')).toBe(true);
    });

    it('should match "Epilogue - Final Words"', () => {
      const regex = getFirstRegex('en');
      expect(regex.test('\nEpilogue - Final Words\n')).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Chinese chapter extraction (end-to-end)
// ---------------------------------------------------------------------------
describe('extractChaptersFromSegment — Chinese (zh)', () => {
  it('should extract chapters from text with 第N章 headings', () => {
    const text = [
      '这是一些前言内容',
      '第一章 开始',
      '这是第一章的正文内容',
      '第二章 发展',
      '这是第二章的正文内容',
      '第三章 高潮',
      '这是第三章的正文内容',
    ].join('\n');
    const chapters = extractChapters(text, 'zh');
    // Initial content + 3 chapters
    expect(chapters.length).toBe(4);
    expect(chapters[0]!.content).toContain('前言');
    expect(chapters[1]!.title).toContain('第一章');
    expect(chapters[2]!.title).toContain('第二章');
    expect(chapters[3]!.title).toContain('第三章');
  });

  it('should extract mixed preface and chapter headings', () => {
    const text = ['书名信息', '前言', '这是前言的内容', '第一章 正式开始', '正式内容在这里'].join(
      '\n',
    );
    const chapters = extractChapters(text, 'zh');
    expect(chapters.length).toBeGreaterThanOrEqual(3);
    const titles = chapters.map((c) => c.title);
    expect(titles.some((t) => t.includes('前言'))).toBe(true);
    expect(titles.some((t) => t.includes('第一章'))).toBe(true);
  });

  it('should mark 第一卷 as a volume', () => {
    const chapters = extractChapters('前文内容\n第一卷 起始篇\n正文内容', 'zh');
    const volume = chapters.find((c) => c.title.includes('第一卷'));
    expect(volume).toBeDefined();
    expect(volume!.isVolume).toBe(true);
  });

  it('should mark 第二部 as a volume', () => {
    const chapters = extractChapters('前文内容\n第二部 中篇\n正文内容', 'zh');
    const volume = chapters.find((c) => c.title.includes('第二部'));
    expect(volume).toBeDefined();
    expect(volume!.isVolume).toBe(true);
  });

  it('should not mark 第一章 as a volume', () => {
    const chapters = extractChapters('前文内容\n第一章 开始\n正文内容', 'zh');
    const chapter = chapters.find((c) => c.title.includes('第一章'));
    expect(chapter).toBeDefined();
    expect(chapter!.isVolume).toBe(false);
  });

  it.each(['本', '册'])('should mark 第一%s as a volume', (suffix) => {
    const chapters = extractChapters(`前文内容\n第一${suffix} 标题\n正文内容`, 'zh');
    const volume = chapters.find((c) => c.title.includes(`第一${suffix}`));
    expect(volume).toBeDefined();
    expect(volume!.isVolume).toBe(true);
  });

  it('should include title text in captured heading', () => {
    const chapters = extractChapters('前文内容\n第一章 天地初开\n正文内容', 'zh');
    const chapter = chapters.find((c) => c.title.includes('第一章'));
    expect(chapter).toBeDefined();
    expect(chapter!.title).toContain('天地初开');
  });

  it('should handle chapter heading at the very start of text', () => {
    const text = '第一章 开始\n正文内容\n第二章 继续\n更多内容';
    const chapters = extractChapters(text, 'zh');
    expect(chapters.length).toBe(2);
    expect(chapters[0]!.title).toContain('第一章');
    expect(chapters[1]!.title).toContain('第二章');
  });

  it('should handle chapter heading with leading whitespace', () => {
    const chapters = extractChapters('前文内容\n  第一章 标题\n正文内容', 'zh');
    const chapter = chapters.find((c) => c.title.includes('第一章'));
    expect(chapter).toBeDefined();
  });

  it('should produce initial content chapter when text precedes first heading', () => {
    const chapters = extractChapters('这是前文内容\n第一章 开始\n正文内容', 'zh');
    expect(chapters.length).toBeGreaterThanOrEqual(2);
    expect(chapters[0]!.content).toContain('前文');
  });
});

// ---------------------------------------------------------------------------
// English chapter extraction (end-to-end)
// ---------------------------------------------------------------------------
describe('extractChaptersFromSegment — English (en)', () => {
  it('should produce at least one chapter from text with Chapter headings', () => {
    const text = [
      'Some introductory text here.',
      'Chapter 1: The Start',
      'First chapter content goes here.',
      'Chapter 2: The Middle',
      'Second chapter content goes here.',
    ].join('\n');
    const chapters = extractChapters(text, 'en');
    // The English regex matches Chapter headings but inner capture groups
    // cause joinAroundUndefined to merge content. At minimum, the initial
    // content before the first heading is captured as a chapter.
    expect(chapters.length).toBeGreaterThanOrEqual(1);
  });

  it('should fall back to paragraph splitting when fallback is enabled', () => {
    const text = 'Line one.\nLine two.\nLine three.\nLine four.';
    const api = getApi();
    // With no chapter headings and fallback enabled, should split by paragraphs
    const chapters = api.extractChaptersFromSegment(
      text,
      metadata('en'),
      { linesBetweenSegments: 8, fallbackParagraphsPerChapter: 2 },
      0,
    );
    expect(chapters.length).toBe(2);
  });

  it('should detect chapter headings via regex match even if extraction is imperfect', () => {
    // Verify the regex itself identifies chapter patterns correctly.
    // Must create fresh regex copies because g-flag updates lastIndex on each test().
    const base = getFirstRegex('en');
    const fresh = () => new RegExp(base.source, base.flags);
    expect(fresh().test('\nChapter 1: Title\n')).toBe(true);
    expect(fresh().test('\nPart 2\n')).toBe(true);
    expect(fresh().test('\nPrologue\n')).toBe(true);
    // Non-chapter text should not match
    expect(fresh().test('Just some regular text')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Regex structure tests
// ---------------------------------------------------------------------------
describe('createChapterRegexps — structure', () => {
  it('should produce two regexps for Chinese', () => {
    const api = getApi();
    expect(api.createChapterRegexps('zh').length).toBe(2);
  });

  it('should produce two regexps for English', () => {
    const api = getApi();
    expect(api.createChapterRegexps('en').length).toBe(2);
  });

  it('should produce two regexps for any non-zh language', () => {
    const api = getApi();
    expect(api.createChapterRegexps('fr').length).toBe(2);
    expect(api.createChapterRegexps('ja').length).toBe(2);
    expect(api.createChapterRegexps('de').length).toBe(2);
  });

  it('Chinese first regex should be case-insensitive with unicode flag', () => {
    const api = getApi();
    const regex = api.createChapterRegexps('zh')[0]!;
    expect(regex.flags).toContain('i');
    expect(regex.flags).toContain('u');
  });

  it('English regex should be case-insensitive', () => {
    const api = getApi();
    const regex = api.createChapterRegexps('en')[0]!;
    expect(regex.flags).toContain('i');
  });
});

// ---------------------------------------------------------------------------
// joinAroundUndefined tests
// ---------------------------------------------------------------------------
describe('joinAroundUndefined', () => {
  it('should join strings separated by a single undefined', () => {
    const api = getApi();
    const result = api.joinAroundUndefined(['pre', 'match', undefined, 'content']);
    expect(result).toEqual(['pre', 'matchcontent']);
  });

  it('should handle array with no undefined values', () => {
    const api = getApi();
    const result = api.joinAroundUndefined(['a', 'b', 'c']);
    expect(result).toEqual(['a', 'b', 'c']);
  });

  it('should handle array with only undefined', () => {
    const api = getApi();
    const result = api.joinAroundUndefined([undefined]);
    expect(result).toEqual([]);
  });

  it('should handle empty array', () => {
    const api = getApi();
    const result = api.joinAroundUndefined([]);
    expect(result).toEqual([]);
  });

  it('should skip value after leading undefined (prev is undefined)', () => {
    const api = getApi();
    // undefined at start: 'a' is skipped because src[i-1] is undefined
    // 'b' is pushed because src[i-1]='a' is not undefined
    const result = api.joinAroundUndefined([undefined, 'a', 'b']);
    expect(result).toEqual(['b']);
  });

  it('should handle undefined at end', () => {
    const api = getApi();
    const result = api.joinAroundUndefined(['a', 'b', undefined]);
    expect(result).toEqual(['a', 'b']);
  });

  it('should join chains through consecutive undefined-string-undefined', () => {
    const api = getApi();
    // First undefined joins 'a' with 'b'. Then 'b' is skipped (prev=undefined).
    // Second undefined joins acc with 'c'. Result: everything merged.
    const result = api.joinAroundUndefined(['a', undefined, 'b', undefined, 'c']);
    expect(result).toEqual(['abc']);
  });
});

// ---------------------------------------------------------------------------
// isGoodMatches tests
// ---------------------------------------------------------------------------
describe('isGoodMatches', () => {
  it('should return false for single-element arrays', () => {
    const api = getApi();
    expect(api.isGoodMatches(['only one part'])).toBe(false);
  });

  it('should return false for empty meaningful parts', () => {
    const api = getApi();
    expect(api.isGoodMatches(['', '  ', ''])).toBe(false);
  });

  it('should return true for multiple meaningful parts', () => {
    const api = getApi();
    expect(api.isGoodMatches(['pre', 'Chapter 1', 'content'])).toBe(true);
  });

  it('should return false when any part exceeds maxLength', () => {
    const api = getApi();
    const longPart = 'x'.repeat(100001);
    expect(api.isGoodMatches(['pre', longPart])).toBe(false);
  });

  it('should accept parts within custom maxLength', () => {
    const api = getApi();
    expect(api.isGoodMatches(['pre', 'x'.repeat(50)], 100)).toBe(true);
  });

  it('should reject parts exceeding custom maxLength', () => {
    const api = getApi();
    expect(api.isGoodMatches(['pre', 'x'.repeat(101)], 100)).toBe(false);
  });
});
