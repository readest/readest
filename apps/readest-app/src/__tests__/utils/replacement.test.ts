import { describe, test, expect, vi, afterEach } from 'vitest';
// MUST BE FIRST — before imports
vi.mock('@/services/translators/cache', () => ({
  initCache: vi.fn(),
  getCachedTranslation: vi.fn(() => null),
  saveToCache: vi.fn(),
  pruneCache: vi.fn(),
}));

vi.mock('@/store/settingsStore', () => {
  const mockState = {
    settings: {
      globalViewSettings: { proofreadRules: [] },
      globalReadSettings: {},
      kosync: { enabled: false },
    },
    setSettings: vi.fn(),
    saveSettings: vi.fn(),
  };

  const fn = vi.fn(() => mockState) as unknown as {
    (): typeof mockState;
    getState: () => typeof mockState;
    setState: (partial: Partial<typeof mockState>) => void;
    subscribe: (listener: () => void) => () => void;
    destroy: () => void;
  };
  fn.getState = () => mockState;
  fn.setState = vi.fn();
  fn.subscribe = vi.fn();
  fn.destroy = vi.fn();

  return { useSettingsStore: fn };
});

vi.mock('@/store/readerStore', () => {
  const mockState = {
    getViewSettings: () => ({ proofreadRules: [] }),
    setViewSettings: vi.fn(),
  };

  const fn = vi.fn(() => mockState) as unknown as {
    (): typeof mockState;
    getState: () => typeof mockState;
    setState: (partial: Partial<typeof mockState>) => void;
    subscribe: (listener: () => void) => () => void;
    destroy: () => void;
  };
  fn.getState = () => mockState;
  fn.setState = vi.fn();
  fn.subscribe = vi.fn();
  fn.destroy = vi.fn();

  return { useReaderStore: fn };
});

vi.mock('@/store/bookDataStore', () => {
  const mockState = {
    getConfig: () => ({}),
    saveConfig: vi.fn(),
  };

  const fn = vi.fn(() => mockState) as unknown as {
    (): typeof mockState;
    getState: () => typeof mockState;
    setState: (partial: Partial<typeof mockState>) => void;
    subscribe: (listener: () => void) => () => void;
    destroy: () => void;
  };
  fn.getState = () => mockState;
  fn.setState = vi.fn();
  fn.subscribe = vi.fn();
  fn.destroy = vi.fn();

  return { useBookDataStore: fn };
});

import { proofreadTransformer } from '@/services/transformers/proofread';
import { TransformContext } from '@/services/transformers/types';
import { ViewSettings, ProofreadRule } from '@/types/book';
import { validateReplacementRulePattern } from '@/store/proofreadStore';

describe('proofreadTransformer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createMockContext = (
    rules: ProofreadRule[] | undefined,
    content: string,
    sectionHref?: string,
  ): TransformContext => {
    const viewSettings = {
      proofreadRules: rules,
    } as Partial<ViewSettings> as ViewSettings;

    return {
      bookKey: 'test-book',
      viewSettings,
      userLocale: 'en',
      content,
      sectionHref,
      transformers: ['proofread'],
    };
  };

  describe('basic functionality', () => {
    test('should return content unchanged when no rules', async () => {
      const ctx = createMockContext(undefined, '<p>Hello world</p>');
      const result = await proofreadTransformer.transform(ctx);
      expect(result).toContain('Hello world');
    });

    test('should return content unchanged when rules array is empty', async () => {
      const ctx = createMockContext([], '<p>Hello world</p>');
      const result = await proofreadTransformer.transform(ctx);
      expect(result).toContain('Hello world');
    });

    test('should apply simple string replacement with whole-word matching', async () => {
      const rules: ProofreadRule[] = [
        {
          id: '1',
          scope: 'book',
          pattern: 'Hello',
          replacement: 'Hi',
          enabled: true,
          isRegex: false,
          caseSensitive: true,
          order: 1,
          wholeWord: true,
        },
      ];
      const ctx = createMockContext(rules, '<p>Hello world</p>');
      const result = await proofreadTransformer.transform(ctx);

      expect(result).toContain('Hi world');
      expect(result).not.toContain('Hello');
    });

    test('should apply multiple simple replacements', async () => {
      const rules: ProofreadRule[] = [
        {
          id: '1',
          scope: 'book',
          pattern: 'cat',
          replacement: 'dog',
          enabled: true,
          isRegex: false,
          caseSensitive: true,
          order: 1,
          wholeWord: true,
        },
        {
          id: '2',
          scope: 'book',
          pattern: 'The',
          replacement: 'A',
          enabled: true,
          isRegex: false,
          caseSensitive: true,
          order: 2,
          wholeWord: true,
        },
      ];
      const ctx = createMockContext(rules, '<p>The cat sat</p>');
      const result = await proofreadTransformer.transform(ctx);

      expect(result).toContain('A dog sat');
    });

    test('should replace all occurrences, not just first', async () => {
      const rules: ProofreadRule[] = [
        {
          id: '1',
          scope: 'book',
          pattern: 'the',
          replacement: 'THE',
          enabled: true,
          isRegex: false,
          caseSensitive: true,
          order: 1,
          wholeWord: true,
        },
      ];
      const ctx = createMockContext(rules, '<p>the cat and the dog</p>');
      const result = await proofreadTransformer.transform(ctx);

      expect(result).toContain('THE cat and THE dog');
    });

    test('should not replace partial word matches with whole-word enabled', async () => {
      const rules: ProofreadRule[] = [
        {
          id: '1',
          scope: 'book',
          pattern: 'cat',
          replacement: 'dog',
          enabled: true,
          isRegex: false,
          caseSensitive: true,
          order: 1,
          wholeWord: true,
        },
      ];
      const ctx = createMockContext(rules, '<p>The cat sat on the category</p>');
      const result = await proofreadTransformer.transform(ctx);

      expect(result).toContain('dog');
      expect(result).toContain('category'); // Should not replace "cat" in "category"
    });
  });

  describe('regex functionality', () => {
    test('should apply regex replacement', async () => {
      const rules: ProofreadRule[] = [
        {
          id: '1',
          scope: 'book',
          pattern: '\\d+',
          replacement: 'NUMBER',
          enabled: true,
          isRegex: true,
          caseSensitive: true,
          order: 1,
          wholeWord: false,
        },
      ];
      const ctx = createMockContext(rules, '<p>I have 5 apples and 10 oranges</p>');
      const result = await proofreadTransformer.transform(ctx);

      const parser = new DOMParser();
      const doc = parser.parseFromString(result, 'text/html');
      const bodyText = doc.body?.textContent || '';
      expect(bodyText).not.toMatch(/\d+/);
      expect(bodyText).toContain('NUMBER');
    });

    test('should handle regex with word boundaries', async () => {
      const rules: ProofreadRule[] = [
        {
          id: '1',
          scope: 'book',
          pattern: '\\bcat\\b',
          replacement: 'dog',
          enabled: true,
          isRegex: true,
          caseSensitive: true,
          order: 1,
          wholeWord: false,
        },
      ];
      const ctx = createMockContext(rules, '<p>The cat sat on the category</p>');
      const result = await proofreadTransformer.transform(ctx);

      expect(result).toContain('dog');
      expect(result).toContain('category');
    });

    test('should handle case-sensitive regex', async () => {
      const rules: ProofreadRule[] = [
        {
          id: '1',
          scope: 'book',
          pattern: 'the',
          replacement: 'THE',
          enabled: true,
          isRegex: true,
          caseSensitive: true,
          order: 1,
          wholeWord: false,
        },
      ];
      const ctx = createMockContext(rules, '<p>The cat and the dog</p>');
      const result = await proofreadTransformer.transform(ctx);

      expect(result).toContain('THE');
      expect(result).toContain('The cat'); // uppercase "The" stays untouched
    });

    test('should handle case-insensitive regex when specified', async () => {
      const rules: ProofreadRule[] = [
        {
          id: '1',
          scope: 'book',
          pattern: 'the',
          replacement: 'THE',
          enabled: true,
          isRegex: true,
          caseSensitive: false,
          order: 1,
          wholeWord: false,
        },
      ];
      const ctx = createMockContext(rules, '<p>The cat and the dog</p>');
      const result = await proofreadTransformer.transform(ctx);

      // Both "The" and "the" should be replaced
      expect(result).toContain('THE cat and THE dog');
    });
  });

  describe('selection scope', () => {
    test('should skip selection rules without matching sectionHref', async () => {
      const rules: ProofreadRule[] = [
        {
          id: '1',
          scope: 'selection',
          pattern: 'test',
          replacement: 'REPLACED',
          enabled: true,
          isRegex: false,
          caseSensitive: true,
          order: 1,
          wholeWord: true,
          sectionHref: 'chapter1.html',
          cfi: 'epubcfi(/6/14!/4/2,/1:0,/1:4)',
        },
      ];
      const ctx = createMockContext(
        rules,
        '<html><body><p>test content</p></body></html>',
        'chapter2.html',
      );
      const result = await proofreadTransformer.transform(ctx);

      // Should not replace because sectionHref doesn't match
      expect(result).toContain('test content');
      expect(result).not.toContain('REPLACED');
    });

    test('should process selection rules with matching sectionHref', async () => {
      const rules: ProofreadRule[] = [
        {
          id: '1',
          scope: 'selection',
          pattern: 'test',
          replacement: 'REPLACED',
          enabled: true,
          isRegex: false,
          caseSensitive: true,
          order: 1,
          wholeWord: true,
          sectionHref: 'chapter1.html',
          cfi: 'epubcfi(/6/14!/4/2,/1:0,/1:4)',
        },
      ];
      const ctx = createMockContext(
        rules,
        '<html><body><p>test content</p></body></html>',
        'chapter1.html',
      );
      const result = await proofreadTransformer.transform(ctx);

      expect(result).not.toContain('test content');
      expect(result).toContain('REPLACED');
    });

    test('should handle selection rules with hash fragments in sectionHref', async () => {
      const rules: ProofreadRule[] = [
        {
          id: '1',
          scope: 'selection',
          pattern: 'test',
          replacement: 'REPLACED',
          enabled: true,
          isRegex: false,
          caseSensitive: true,
          order: 1,
          wholeWord: true,
          sectionHref: 'chapter1.html#section2',
          cfi: 'epubcfi(/6/14!/4/2,/1:0,/1:4)',
        },
      ];
      const ctx = createMockContext(
        rules,
        '<html><body><p>test content</p></body></html>',
        'chapter1.html#section3',
      );
      const result = await proofreadTransformer.transform(ctx);

      expect(result).not.toContain('test content');
      expect(result).toContain('REPLACED');
    });

    test('should not process selection rules without sectionHref', async () => {
      const rules: ProofreadRule[] = [
        {
          id: '1',
          scope: 'selection',
          pattern: 'test',
          replacement: 'REPLACED',
          enabled: true,
          isRegex: false,
          caseSensitive: true,
          order: 1,
          wholeWord: true,
          cfi: 'epubcfi(/6/14!/4/2,/1:0,/1:4)',
          // No sectionHref
        },
      ];
      const ctx = createMockContext(
        rules,
        '<html><body><p>test content</p></body></html>',
        'chapter1.html',
      );
      const result = await proofreadTransformer.transform(ctx);

      // Selection rules without sectionHref should be skipped
      expect(result).toContain('test content');
    });

    test('should handle invalid CFI gracefully', async () => {
      const rules: ProofreadRule[] = [
        {
          id: '1',
          scope: 'selection',
          pattern: 'test',
          replacement: 'REPLACED',
          enabled: true,
          isRegex: false,
          caseSensitive: true,
          order: 1,
          wholeWord: true,
          sectionHref: 'chapter1.html',
          cfi: 'invalid-cfi',
        },
      ];
      const ctx = createMockContext(rules, '<p>test content</p>', 'chapter1.html');
      const result = await proofreadTransformer.transform(ctx);

      // Should not crash, content should remain unchanged
      expect(result).toBeDefined();
      expect(result).toContain('test');
    });
  });

  describe('case sensitivity (book scope)', () => {
    test('should be case-sensitive by default for book scope', async () => {
      const rules: ProofreadRule[] = [
        {
          id: '1',
          scope: 'book',
          pattern: 'hello',
          replacement: 'hi',
          enabled: true,
          isRegex: false,
          caseSensitive: true,
          order: 1,
          wholeWord: true,
        },
      ];
      const ctx = createMockContext(rules, '<p>Hello world hello there Hello</p>');
      const result = await proofreadTransformer.transform(ctx);

      // Only lowercase "hello" should match
      expect(result).toContain('Hello world hi there Hello');
      const helloCount = (result.match(/Hello/g) || []).length;
      const hiCount = (result.match(/\bhi\b/g) || []).length;
      expect(helloCount).toBe(2); // Two "Hello" remain
      expect(hiCount).toBe(1); // One "hello" replaced
    });

    test('should replace all case-sensitive matches in book scope', async () => {
      const rules: ProofreadRule[] = [
        {
          id: '1',
          scope: 'book',
          pattern: 'world',
          replacement: 'universe',
          enabled: true,
          isRegex: false,
          caseSensitive: true,
          order: 1,
          wholeWord: true,
        },
      ];
      const ctx = createMockContext(rules, '<p>world and world and World</p>');
      const result = await proofreadTransformer.transform(ctx);

      // Both lowercase "world" should match, "World" should not
      expect(result).toContain('universe and universe and World');
      const worldCount = (result.match(/World/g) || []).length;
      const universeCount = (result.match(/universe/g) || []).length;
      expect(worldCount).toBe(1); // One "World" remains
      expect(universeCount).toBe(2);
    });
  });

  describe('case sensitivity (library scope)', () => {
    test('should be case-sensitive by default for library scope', async () => {
      const rules: ProofreadRule[] = [
        {
          id: 'library-1',
          scope: 'library',
          pattern: 'book',
          replacement: 'tome',
          enabled: true,
          isRegex: false,
          caseSensitive: true,
          order: 1,
          wholeWord: true,
        },
      ];

      const ctx = createMockContext(rules, '<p>book and Book and BOOK</p>');
      const result = await proofreadTransformer.transform(ctx);

      // Only lowercase "book" should match
      expect(result).toContain('tome and Book and BOOK');
      const bookCount = (result.match(/Book|BOOK/g) || []).length;
      const tomeCount = (result.match(/tome/g) || []).length;
      expect(bookCount).toBe(2); // "Book" and "BOOK" remain
      expect(tomeCount).toBe(1);
    });

    test('should replace all case-sensitive matches across library scope', async () => {
      const rules: ProofreadRule[] = [
        {
          id: 'library-1',
          scope: 'library',
          pattern: 'test',
          replacement: 'exam',
          enabled: true,
          isRegex: false,
          caseSensitive: true,
          order: 1,
          wholeWord: true,
        },
      ];

      const ctx = createMockContext(rules, '<p>test and test and Test and TEST</p>');
      const result = await proofreadTransformer.transform(ctx);

      // Only lowercase "test" should match
      expect(result).toContain('exam and exam and Test and TEST');
      const testCount = (result.match(/Test|TEST/g) || []).length;
      const examCount = (result.match(/exam/g) || []).length;
      expect(testCount).toBe(2); // "Test" and "TEST" remain
      expect(examCount).toBe(2);
    });
  });

  describe('case sensitivity toggle (book scope)', () => {
    test('should replace case-sensitive when flag is true', async () => {
      const rules: ProofreadRule[] = [
        {
          id: '1',
          scope: 'book',
          pattern: 'test',
          replacement: 'exam',
          enabled: true,
          isRegex: false,
          caseSensitive: true,
          order: 1,
          wholeWord: true,
        },
      ];
      const ctx = createMockContext(rules, '<p>test Test TEST</p>');
      const result = await proofreadTransformer.transform(ctx);

      // Only lowercase "test" should be replaced
      expect(result).toContain('exam Test TEST');
    });

    test('should replace case-insensitive when flag is false', async () => {
      const rules: ProofreadRule[] = [
        {
          id: '1',
          scope: 'book',
          pattern: 'test',
          replacement: 'exam',
          enabled: true,
          isRegex: false,
          caseSensitive: false,
          order: 1,
          wholeWord: true,
        },
      ];
      const ctx = createMockContext(rules, '<p>test Test TEST</p>');
      const result = await proofreadTransformer.transform(ctx);

      // All variants should be replaced
      expect(result).toContain('exam exam exam');
    });

    test('should replace all occurrences case-insensitively with toggle', async () => {
      const rules: ProofreadRule[] = [
        {
          id: '1',
          scope: 'book',
          pattern: 'hello',
          replacement: 'hi',
          enabled: true,
          isRegex: false,
          caseSensitive: false,
          order: 1,
          wholeWord: true,
        },
      ];
      const ctx = createMockContext(rules, '<p>hello Hello HELLO</p>');
      const result = await proofreadTransformer.transform(ctx);

      // All should be replaced
      expect(result).toContain('hi hi hi');
      const hiCount = (result.match(/\bhi\b/gi) || []).length;
      expect(hiCount).toBe(3);
    });
  });

  describe('case sensitivity toggle (library scope)', () => {
    test('should be case-sensitive when flag is true in library scope', async () => {
      const rules: ProofreadRule[] = [
        {
          id: 'library-1',
          scope: 'library',
          pattern: 'world',
          replacement: 'universe',
          enabled: true,
          isRegex: false,
          caseSensitive: true,
          order: 1,
          wholeWord: true,
        },
      ];

      const ctx = createMockContext(rules, '<p>world World WORLD</p>');
      const result = await proofreadTransformer.transform(ctx);

      // Only lowercase "world" replaced
      expect(result).toContain('universe World WORLD');
    });

    test('should be case-insensitive when flag is false in library scope', async () => {
      const rules: ProofreadRule[] = [
        {
          id: 'library-1',
          scope: 'library',
          pattern: 'world',
          replacement: 'universe',
          enabled: true,
          isRegex: false,
          caseSensitive: false,
          order: 1,
          wholeWord: true,
        },
      ];

      const ctx = createMockContext(rules, '<p>world World WORLD</p>');
      const result = await proofreadTransformer.transform(ctx);

      // All should be replaced
      expect(result).toContain('universe universe universe');
      const universeCount = (result.match(/universe/gi) || []).length;
      expect(universeCount).toBe(3);
    });
  });

  describe('scope precedence', () => {
    test('selection should be processed first, then book, then library', async () => {
      const rules: ProofreadRule[] = [
        {
          id: 'library-1',
          scope: 'library',
          pattern: 'world',
          replacement: 'LIBRARY',
          enabled: true,
          isRegex: false,
          caseSensitive: true,
          order: 3,
          wholeWord: true,
        },
        {
          id: 'book-1',
          scope: 'book',
          pattern: 'world',
          replacement: 'BOOK',
          enabled: true,
          isRegex: false,
          caseSensitive: true,
          order: 2,
          wholeWord: true,
        },
      ];

      const ctx = createMockContext(rules, '<p>world world</p>');
      const result = await proofreadTransformer.transform(ctx);

      // Book-scope replacement should apply first due to scope ordering
      expect(result).toContain('BOOK BOOK');
      expect(result).not.toContain('LIBRARY');
    });

    test('should respect order within same scope', async () => {
      const rules: ProofreadRule[] = [
        {
          id: '2',
          scope: 'book',
          pattern: 'cat',
          replacement: 'dog',
          enabled: true,
          isRegex: false,
          caseSensitive: true,
          order: 2,
          wholeWord: true,
        },
        {
          id: '1',
          scope: 'book',
          pattern: 'The',
          replacement: 'A',
          enabled: true,
          isRegex: false,
          caseSensitive: true,
          order: 1,
          wholeWord: true,
        },
      ];
      const ctx = createMockContext(rules, '<p>The cat sat</p>');
      const result = await proofreadTransformer.transform(ctx);

      // First "The" -> "A" (order 1), then "cat" -> "dog" (order 2)
      expect(result).toContain('A dog sat');
    });
  });

  describe('rule ordering', () => {
    test('should apply rules in order (lower order numbers first)', async () => {
      const rules: ProofreadRule[] = [
        {
          id: '2',
          scope: 'book',
          pattern: 'cat',
          replacement: 'dog',
          enabled: true,
          isRegex: false,
          caseSensitive: true,
          order: 2,
          wholeWord: true,
        },
        {
          id: '1',
          scope: 'book',
          pattern: 'The',
          replacement: 'A',
          enabled: true,
          isRegex: false,
          caseSensitive: true,
          order: 1,
          wholeWord: true,
        },
      ];
      const ctx = createMockContext(rules, '<p>The cat sat</p>');
      const result = await proofreadTransformer.transform(ctx);

      expect(result).toContain('A dog sat');
    });

    test('should handle rules with same order', async () => {
      const rules: ProofreadRule[] = [
        {
          id: '1',
          scope: 'book',
          pattern: 'a',
          replacement: 'A',
          enabled: true,
          isRegex: false,
          caseSensitive: true,
          order: 1,
          wholeWord: true,
        },
        {
          id: '2',
          scope: 'book',
          pattern: 'b',
          replacement: 'B',
          enabled: true,
          isRegex: false,
          caseSensitive: true,
          order: 1,
          wholeWord: true,
        },
      ];
      const ctx = createMockContext(rules, '<p>a b c</p>');
      const result = await proofreadTransformer.transform(ctx);

      // Both should be applied
      expect(result).toContain('A B c');
    });
  });

  describe('enabled/disabled rules', () => {
    test('should skip disabled rules', async () => {
      const rules: ProofreadRule[] = [
        {
          id: '1',
          scope: 'book',
          pattern: 'Hello',
          replacement: 'Hi',
          enabled: false,
          isRegex: false,
          caseSensitive: true,
          order: 1,
          wholeWord: true,
        },
      ];
      const ctx = createMockContext(rules, '<p>Hello world</p>');
      const result = await proofreadTransformer.transform(ctx);

      expect(result).toContain('Hello');
      expect(result).not.toContain('Hi');
    });

    test('should only apply enabled rules', async () => {
      const rules: ProofreadRule[] = [
        {
          id: '1',
          scope: 'book',
          pattern: 'Hello',
          replacement: 'Hi',
          enabled: false,
          isRegex: false,
          caseSensitive: true,
          order: 1,
          wholeWord: true,
        },
        {
          id: '2',
          scope: 'book',
          pattern: 'world',
          replacement: 'universe',
          enabled: true,
          isRegex: false,
          caseSensitive: true,
          order: 2,
          wholeWord: true,
        },
      ];
      const ctx = createMockContext(rules, '<p>Hello world</p>');
      const result = await proofreadTransformer.transform(ctx);

      expect(result).toContain('Hello');
      expect(result).toContain('universe');
    });
  });

  describe('error handling', () => {
    test('should handle invalid regex gracefully', async () => {
      const rules: ProofreadRule[] = [
        {
          id: '1',
          scope: 'book',
          pattern: '[invalid',
          replacement: 'fixed',
          enabled: true,
          isRegex: true,
          caseSensitive: true,
          order: 1,
          wholeWord: false,
        },
      ];
      const ctx = createMockContext(rules, '<p>Test content</p>');
      const result = await proofreadTransformer.transform(ctx);

      expect(result).toContain('Test content');
    });

    test('should continue processing other rules after invalid regex', async () => {
      const rules: ProofreadRule[] = [
        {
          id: '1',
          scope: 'book',
          pattern: '[invalid',
          replacement: 'fixed',
          enabled: true,
          isRegex: true,
          caseSensitive: true,
          order: 1,
          wholeWord: false,
        },
        {
          id: '2',
          scope: 'book',
          pattern: 'Test',
          replacement: 'PASSED',
          enabled: true,
          isRegex: false,
          caseSensitive: true,
          order: 2,
          wholeWord: true,
        },
      ];
      const ctx = createMockContext(rules, '<p>Test content</p>');
      const result = await proofreadTransformer.transform(ctx);

      expect(result).toContain('PASSED');
    });
  });

  describe('HTML preservation', () => {
    test('should preserve HTML structure', async () => {
      const rules: ProofreadRule[] = [
        {
          id: '1',
          scope: 'book',
          pattern: 'text',
          replacement: 'TEXT',
          enabled: true,
          isRegex: false,
          caseSensitive: true,
          order: 1,
          wholeWord: true,
        },
      ];
      const ctx = createMockContext(rules, '<p>Some text here</p><span>More text</span>');
      const result = await proofreadTransformer.transform(ctx);

      expect(result).toContain('<p>');
      expect(result).toContain('</p>');
      expect(result).toContain('<span>');
      expect(result).toContain('</span>');
      expect(result).toContain('TEXT');
    });

    test('should skip script and style tags', async () => {
      const rules: ProofreadRule[] = [
        {
          id: '1',
          scope: 'book',
          pattern: 'text',
          replacement: 'TEXT',
          enabled: true,
          isRegex: false,
          caseSensitive: true,
          order: 1,
          wholeWord: true,
        },
      ];
      const ctx = createMockContext(
        rules,
        '<p>Some text</p><script>var text = "test";</script><style>.text { color: red; }</style>',
      );
      const result = await proofreadTransformer.transform(ctx);

      // Text in <p> should be replaced
      expect(result).toContain('Some TEXT');
      // Text in <script> and <style> should remain unchanged
      expect(result).toContain('var text = "test"');
      expect(result).toContain('.text { color: red; }');
    });
  });

  describe('unicode and special characters', () => {
    test('should handle unicode characters', async () => {
      const rules: ProofreadRule[] = [
        {
          id: '1',
          scope: 'book',
          pattern: 'café',
          replacement: 'cafe',
          enabled: true,
          isRegex: false,
          caseSensitive: true,
          order: 1,
          wholeWord: true,
        },
      ];
      const ctx = createMockContext(rules, '<p>café</p>');
      const result = await proofreadTransformer.transform(ctx);

      expect(result).toContain('cafe');
      expect(result).not.toContain('café');
    });

    test('should handle special regex characters in simple mode', async () => {
      const rules: ProofreadRule[] = [
        {
          id: '1',
          scope: 'book',
          pattern: 'a.b',
          replacement: 'A.B',
          enabled: true,
          isRegex: false,
          caseSensitive: true,
          order: 1,
          wholeWord: true,
        },
      ];

      const ctx = createMockContext(rules, '<p>a.b and aXb</p>');
      const result = await proofreadTransformer.transform(ctx);

      expect(result).toContain('A.B');
      expect(result).toContain('aXb');
    });
  });

  describe('edge cases', () => {
    test('should handle empty pattern', async () => {
      const rules: ProofreadRule[] = [
        {
          id: '1',
          scope: 'book',
          pattern: '',
          replacement: 'X',
          enabled: true,
          isRegex: false,
          caseSensitive: true,
          order: 1,
          wholeWord: true,
        },
      ];
      const ctx = createMockContext(rules, '<p>test</p>');
      const result = await proofreadTransformer.transform(ctx);

      // empty pattern produces no changes (filtered out by .filter(r => r.pattern.trim()))
      expect(result).toBe(ctx.content);
    });

    test('should handle empty replacement', async () => {
      const rules: ProofreadRule[] = [
        {
          id: '1',
          scope: 'book',
          pattern: 'test',
          replacement: '',
          enabled: true,
          isRegex: false,
          caseSensitive: true,
          order: 1,
          wholeWord: true,
        },
      ];
      const ctx = createMockContext(rules, '<p>test content</p>');
      const result = await proofreadTransformer.transform(ctx);

      expect(result).not.toContain('test');
      expect(result).toContain('content');
    });

    test('should handle rules with undefined order', async () => {
      const rules: ProofreadRule[] = [
        {
          id: '1',
          scope: 'book',
          pattern: 'test',
          replacement: 'TEST',
          enabled: true,
          isRegex: false,
          caseSensitive: true,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          order: undefined as any,
          wholeWord: true,
        },
      ];
      const ctx = createMockContext(rules, '<p>test</p>');
      const result = await proofreadTransformer.transform(ctx);

      expect(result).toContain('TEST');
    });

    test('should handle complex HTML with nested elements', async () => {
      const rules: ProofreadRule[] = [
        {
          id: '1',
          scope: 'book',
          pattern: 'text',
          replacement: 'TEXT',
          enabled: true,
          isRegex: false,
          caseSensitive: true,
          order: 1,
          wholeWord: true,
        },
      ];
      const ctx = createMockContext(
        rules,
        '<div><p>Some text</p><span>More text <strong>here</strong></span></div>',
      );
      const result = await proofreadTransformer.transform(ctx);

      expect(result).toContain('Some TEXT');
      expect(result).toContain('More TEXT');
      expect(result).toContain('<strong>');
      expect(result).toContain('</strong>');
    });
  });

  describe('validateReplacementRulePattern', () => {
    test('should validate simple string pattern', () => {
      const result = validateReplacementRulePattern('test', false);
      expect(result.valid).toBe(true);
    });

    test('should reject empty pattern', () => {
      const result = validateReplacementRulePattern('', false);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('empty');
    });

    test('should validate valid regex pattern', () => {
      const result = validateReplacementRulePattern('\\d+', true);
      expect(result.valid).toBe(true);
    });

    test('should reject invalid regex pattern', () => {
      const result = validateReplacementRulePattern('[invalid', true);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
