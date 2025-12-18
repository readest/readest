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
      globalViewSettings: { replacementRules: [] },
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
    getViewSettings: () => ({ replacementRules: [] }),
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

import { replacementTransformer } from '@/services/transformers/replacement';
import { TransformContext } from '@/services/transformers/types';
import { ViewSettings, ReplacementRule } from '@/types/book';
import {
  createReplacementRule,
  mergeReplacementRules,
  validateReplacementRulePattern,
} from '@/services/transformers/replacement';

describe('replacementTransformer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createMockContext = (
    rules: ReplacementRule[] | undefined,
    content: string,
  ): TransformContext => {
    const viewSettings = {
      replacementRules: rules,
    } as Partial<ViewSettings> as ViewSettings;

    return {
      bookKey: 'test-book',
      viewSettings,
      userLocale: 'en',
      content,
      transformers: ['replacement'],
    };
  };

  describe('basic functionality', () => {
    test('should return content unchanged when no rules', async () => {
      const ctx = createMockContext(undefined, '<p>Hello world</p>');
      const result = await replacementTransformer.transform(ctx);
      expect(result).toContain('Hello world');
    });

    test('should return content unchanged when rules array is empty', async () => {
      const ctx = createMockContext([], '<p>Hello world</p>');
      const result = await replacementTransformer.transform(ctx);

      expect(result).toContain('Hello world');
    });

    test('should apply simple string replacement', async () => {
      const rules: ReplacementRule[] = [
        {
          id: '1',
          pattern: 'Hello',
          replacement: 'Hi',
          enabled: true,
          isRegex: false,
          order: 1,
        },
      ];
      const ctx = createMockContext(rules, '<p>Hello world</p>');
      const result = await replacementTransformer.transform(ctx);

      expect(result).toContain('Hi world');
      expect(result).not.toContain('Hello');
    });

    test('should apply multiple simple replacements', async () => {
      const rules: ReplacementRule[] = [
        {
          id: '1',
          pattern: 'cat',
          replacement: 'dog',
          enabled: true,
          isRegex: false,
          order: 1,
        },
        {
          id: '2',
          pattern: 'The',
          replacement: 'A',
          enabled: true,
          isRegex: false,
          order: 2,
        },
      ];
      const ctx = createMockContext(rules, '<p>The cat sat</p>');
      const result = await replacementTransformer.transform(ctx);

      expect(result).toContain('A dog sat');
    });

    test('should replace all occurrences, not just first', async () => {
      const rules: ReplacementRule[] = [
        {
          id: '1',
          pattern: 'the',
          replacement: 'THE',
          enabled: true,
          isRegex: false,
          order: 1,
        },
      ];
      const ctx = createMockContext(rules, '<p>the cat and the dog</p>');
      const result = await replacementTransformer.transform(ctx);

      expect(result).toContain('THE cat and THE dog');
    });
  });

  describe('regex functionality', () => {
    test('should apply regex replacement', async () => {
      const rules: ReplacementRule[] = [
        {
          id: '1',
          pattern: '\\d+',
          replacement: 'NUMBER',
          enabled: true,
          isRegex: true,
          order: 1,
        },
      ];
      const ctx = createMockContext(rules, '<p>I have 5 apples and 10 oranges</p>');
      const result = await replacementTransformer.transform(ctx);
      expect(result).toContain('NUMBER');
      // Check that numbers in the body content are replaced (not in XML namespace URLs)
      const parser = new DOMParser();
      const doc = parser.parseFromString(result, 'text/html');
      const bodyText = doc.body?.textContent || '';
      expect(bodyText).not.toMatch(/\d+/);
      expect(bodyText).toContain('NUMBER');
    });

    test('should handle regex with word boundaries', async () => {
      const rules: ReplacementRule[] = [
        {
          id: '1',
          pattern: '\\bcat\\b',
          replacement: 'dog',
          enabled: true,
          isRegex: true,
          order: 1,
        },
      ];
      const ctx = createMockContext(rules, '<p>The cat sat on the category</p>');
      const result = await replacementTransformer.transform(ctx);

      expect(result).toContain('dog');
      expect(result).toContain('category'); // Should not replace "cat" in "category"
    });

    test('should handle case-insensitive regex when specified', async () => {
      const rules: ReplacementRule[] = [
        {
          id: '1',
          pattern: 'the',
          replacement: 'THE',
          enabled: true,
          isRegex: true,
          order: 1,
          caseSensitive: true,
        },
      ];
      const ctx = createMockContext(rules, '<p>The cat and the dog</p>');
      const result = await replacementTransformer.transform(ctx);

      // Note: Our implementation uses 'g' flag, so it will match "the" but not "The"
      // This is expected behavior - regex is case-sensitive by default
      expect(result).toContain('THE');
      expect(result).toContain('The cat'); // uppercase "The" stays untouched
    });
  });

  describe('case sensitivity (single instance)', () => {
    test('should be case-sensitive by default for single instance', async () => {
      const rules: ReplacementRule[] = [
        {
          id: '1',
          pattern: 'hello',
          replacement: 'hi',
          enabled: true,
          isRegex: false,
          singleInstance: true,
          occurrenceIndex: 0,
          order: 1,
        },
      ];
      const ctx = createMockContext(rules, '<p>Hello world hello there</p>');
      const result = await replacementTransformer.transform(ctx);

      // "hello" (lowercase) should match, "Hello" should not
      expect(result).toContain('Hello world hi there');
      expect(result).not.toContain('hi world hi there');
    });

    test('should replace case-sensitive match at correct occurrence', async () => {
      const rules: ReplacementRule[] = [
        {
          id: '1',
          pattern: 'hello',
          replacement: 'hi',
          enabled: true,
          isRegex: false,
          singleInstance: true,
          occurrenceIndex: 1, // second occurrence
          order: 1,
        },
      ];
      const ctx = createMockContext(rules, '<p>hello world and hello again</p>');
      const result = await replacementTransformer.transform(ctx);

      // Only second "hello" should be replaced
      expect(result).toContain('hello world and hi again');
      const helloCount = (result.match(/hello/g) || []).length;
      const hiCount = (result.match(/hi/g) || []).length;
      expect(helloCount).toBe(1);
      expect(hiCount).toBe(1);
    });
  });

  describe('case sensitivity (book scope)', () => {
    test('should be case-sensitive by default for book scope', async () => {
      const rules: ReplacementRule[] = [
        {
          id: '1',
          pattern: 'hello',
          replacement: 'hi',
          enabled: true,
          isRegex: false,
          singleInstance: false,
          order: 1,
        },
      ];
      const ctx = createMockContext(rules, '<p>Hello world hello there Hello</p>');
      const result = await replacementTransformer.transform(ctx);

      // Only lowercase "hello" should match
      expect(result).toContain('Hello world hi there Hello');
      const helloCount = (result.match(/[Hh]ello/g) || []).length;
      const hiCount = (result.match(/hi/g) || []).length;
      expect(helloCount).toBe(2); // Two "Hello" remain
      expect(hiCount).toBe(1); // One "hello" replaced
    });

    test('should replace all case-sensitive matches in book scope', async () => {
      const rules: ReplacementRule[] = [
        {
          id: '1',
          pattern: 'world',
          replacement: 'universe',
          enabled: true,
          isRegex: false,
          singleInstance: false,
          order: 1,
        },
      ];
      const ctx = createMockContext(rules, '<p>world and world and World</p>');
      const result = await replacementTransformer.transform(ctx);

      // Both lowercase "world" should match, "World" should not
      expect(result).toContain('universe and universe and World');
      const worldCount = (result.match(/[Ww]orld/g) || []).length;
      const universeCount = (result.match(/universe/g) || []).length;
      expect(worldCount).toBe(1); // One "World" remains
      expect(universeCount).toBe(2);
    });
  });

  describe('case sensitivity (global scope)', () => {
    test('should be case-sensitive by default for global scope', async () => {
      // Simulate global rules via the merged rules mechanism
      const globalRules: ReplacementRule[] = [
        {
          id: 'global-1',
          pattern: 'book',
          replacement: 'tome',
          enabled: true,
          isRegex: false,
          singleInstance: false,
          global: true,
          order: 1,
        },
      ];

      const ctx = createMockContext(globalRules, '<p>book and Book and BOOK</p>');
      const result = await replacementTransformer.transform(ctx);

      // Only lowercase "book" should match
      expect(result).toContain('tome and Book and BOOK');
      const bookCount = (result.match(/[Bb]ook|BOOK/g) || []).length;
      const tomeCount = (result.match(/tome/g) || []).length;
      expect(bookCount).toBe(2); // "Book" and "BOOK" remain
      expect(tomeCount).toBe(1);
    });

    test('should replace all case-sensitive matches across global scope', async () => {
      const globalRules: ReplacementRule[] = [
        {
          id: 'global-1',
          pattern: 'test',
          replacement: 'exam',
          enabled: true,
          isRegex: false,
          singleInstance: false,
          global: true,
          order: 1,
        },
      ];

      const ctx = createMockContext(globalRules, '<p>test and test and Test and TEST</p>');
      const result = await replacementTransformer.transform(ctx);

      // Only lowercase "test" should match
      expect(result).toContain('exam and exam and Test and TEST');
      const testCount = (result.match(/[Tt]est|TEST/g) || []).length;
      const examCount = (result.match(/exam/g) || []).length;
      expect(testCount).toBe(2); // "Test" and "TEST" remain
      expect(examCount).toBe(2);
    });
  });

  describe('case sensitivity toggle (single instance)', () => {
    test('should respect case-sensitive toggle for single instance', async () => {
      const rules: ReplacementRule[] = [
        {
          id: '1',
          pattern: 'hello',
          replacement: 'hi',
          enabled: true,
          isRegex: false,
          singleInstance: true,
          occurrenceIndex: 0,
          caseSensitive: true, // Explicitly case-sensitive
          order: 1,
        },
      ];
      const ctx = createMockContext(rules, '<p>Hello world hello there</p>');
      const result = await replacementTransformer.transform(ctx);

      // Only exact case match should be replaced
      expect(result).toContain('Hello world hi there');
    });

    test('should respect case-insensitive toggle for single instance (explicit)', async () => {
      const rules: ReplacementRule[] = [
        {
          id: '1',
          pattern: 'hello',
          replacement: 'hi',
          enabled: true,
          isRegex: false,
          singleInstance: true,
          occurrenceIndex: 0,
          caseSensitive: false, // Case-insensitive but will be ignored
          order: 1,
        },
      ];
      const ctx = createMockContext(rules, '<p>Hello world hello there</p>');
      const result = await replacementTransformer.transform(ctx);

      // First match should be replaced, case sensitve is set to true by default for single instance
      expect(result).toContain('Hello world hi there');
      const hiCount = (result.match(/hi/g) || []).length;
      expect(hiCount).toBe(1);
    });
  });

  describe('case sensitivity toggle (book scope)', () => {
    test('should replace case-sensitive when flag is true', async () => {
      const rules: ReplacementRule[] = [
        {
          id: '1',
          pattern: 'test',
          replacement: 'exam',
          enabled: true,
          isRegex: false,
          singleInstance: false,
          caseSensitive: true, // Case-sensitive
          order: 1,
        },
      ];
      const ctx = createMockContext(rules, '<p>test Test TEST</p>');
      const result = await replacementTransformer.transform(ctx);

      // Only lowercase "test" should be replaced
      expect(result).toContain('exam Test TEST');
    });

    test('should replace case-insensitive when flag is false (explicit)', async () => {
      const rules: ReplacementRule[] = [
        {
          id: '1',
          pattern: 'test',
          replacement: 'exam',
          enabled: true,
          isRegex: false,
          singleInstance: false,
          caseSensitive: false, // Case-insensitive (explicitly set)
          order: 1,
        },
      ];
      const ctx = createMockContext(rules, '<p>test Test TEST</p>');
      const result = await replacementTransformer.transform(ctx);

      // All variants should be replaced
      expect(result).toContain('exam exam exam');
    });

    test('should replace all occurrences case-insensitively with toggle', async () => {
      const rules: ReplacementRule[] = [
        {
          id: '1',
          pattern: 'hello',
          replacement: 'hi',
          enabled: true,
          isRegex: false,
          singleInstance: false,
          caseSensitive: false, // Case-insensitive
          order: 1,
        },
      ];
      const ctx = createMockContext(rules, '<p>hello Hello HELLO</p>');
      const result = await replacementTransformer.transform(ctx);

      // All should be replaced
      expect(result).toContain('hi hi hi');
      const hiCount = (result.match(/hi/g) || []).length;
      expect(hiCount).toBe(3);
    });
  });

  describe('case sensitivity toggle (global scope)', () => {
    test('should be case-sensitive when flag is true in global scope', async () => {
      const globalRules: ReplacementRule[] = [
        {
          id: 'global-1',
          pattern: 'world',
          replacement: 'universe',
          enabled: true,
          isRegex: false,
          singleInstance: false,
          caseSensitive: true, // Explicitly case-sensitive
          global: true,
          order: 1,
        },
      ];

      const ctx = createMockContext(globalRules, '<p>world World WORLD</p>');
      const result = await replacementTransformer.transform(ctx);

      // Only lowercase "world" replaced
      expect(result).toContain('universe World WORLD');
    });

    test('should be case-insensitive when flag is false (explicit) in global scope', async () => {
      const globalRules: ReplacementRule[] = [
        {
          id: 'global-1',
          pattern: 'world',
          replacement: 'universe',
          enabled: true,
          isRegex: false,
          singleInstance: false,
          caseSensitive: false, // Case-insensitive
          global: true,
          order: 1,
        },
      ];

      const ctx = createMockContext(globalRules, '<p>world World WORLD</p>');
      const result = await replacementTransformer.transform(ctx);

      // All should be replaced
      expect(result).toContain('universe universe universe');
      const universeCount = (result.match(/universe/g) || []).length;
      expect(universeCount).toBe(3);
    });
  });

  describe('scope precedence', () => {
    test('single-instance should override book/global for that occurrence', async () => {
      const rules: ReplacementRule[] = [
        {
          id: 'single-1',
          pattern: 'Hello',
          replacement: 'Hi-once',
          enabled: true,
          isRegex: false,
          singleInstance: true,
          occurrenceIndex: 0,
          sectionHref: 'chap1',
          order: 1,
        },
        {
          id: 'book-1',
          pattern: 'Hello',
          replacement: 'Hi-book',
          enabled: true,
          isRegex: false,
          singleInstance: false,
          order: 2,
        },
        {
          id: 'global-1',
          pattern: 'Hello',
          replacement: 'Hi-global',
          enabled: true,
          isRegex: false,
          singleInstance: false,
          global: true,
          order: 3,
        },
      ];

      const ctx = createMockContext(rules, '<p>Hello Hello</p>');
      // Simulate sectionHref to match single-instance rule
      ctx.sectionHref = 'chap1';

      const result = await replacementTransformer.transform(ctx);

      // First occurrence should use single-instance replacement; second should fall to book (before global)
      expect(result).toContain('Hi-once Hi-book');
      expect(result).not.toContain('Hi-global');
    });

    test('book should win over global for same pattern', async () => {
      const rules: ReplacementRule[] = [
        {
          id: 'book-1',
          pattern: 'world',
          replacement: 'BOOK',
          enabled: true,
          isRegex: false,
          singleInstance: false,
          order: 1,
        },
        {
          id: 'global-1',
          pattern: 'world',
          replacement: 'GLOBAL',
          enabled: true,
          isRegex: false,
          singleInstance: false,
          global: true,
          order: 2,
        },
      ];

      const ctx = createMockContext(rules, '<p>world world</p>');
      const result = await replacementTransformer.transform(ctx);

      // Book-scope replacement should apply; global should not override
      expect(result).toContain('BOOK BOOK');
      expect(result).not.toContain('GLOBAL');
    });
  });

  describe('rule ordering', () => {
    test('should apply rules in order (lower order numbers first)', async () => {
      const rules: ReplacementRule[] = [
        {
          id: '2',
          pattern: 'cat',
          replacement: 'dog',
          enabled: true,
          isRegex: false,
          order: 2,
        },
        {
          id: '1',
          pattern: 'The',
          replacement: 'A',
          enabled: true,
          isRegex: false,
          order: 1,
        },
      ];
      const ctx = createMockContext(rules, '<p>The cat sat</p>');
      const result = await replacementTransformer.transform(ctx);

      // First "The" -> "A" (order 1), then "cat" -> "dog" (order 2)
      expect(result).toContain('A dog sat');
    });

    test('should handle rules with same order', async () => {
      const rules: ReplacementRule[] = [
        {
          id: '1',
          pattern: 'a',
          replacement: 'A',
          enabled: true,
          isRegex: false,
          order: 1,
        },
        {
          id: '2',
          pattern: 'b',
          replacement: 'B',
          enabled: true,
          isRegex: false,
          order: 1, // Same order
        },
      ];
      const ctx = createMockContext(rules, '<p>a b c</p>');
      const result = await replacementTransformer.transform(ctx);

      // Both should be applied (whole-word matching)
      expect(result).toContain('A B c');
    });
  });

  describe('enabled/disabled rules', () => {
    test('should skip disabled rules', async () => {
      const rules: ReplacementRule[] = [
        {
          id: '1',
          pattern: 'Hello',
          replacement: 'Hi',
          enabled: false,
          isRegex: false,
          order: 1,
        },
      ];
      const ctx = createMockContext(rules, '<p>Hello world</p>');
      const result = await replacementTransformer.transform(ctx);

      expect(result).toContain('Hello');
      expect(result).not.toContain('Hi');
    });

    test('should only apply enabled rules', async () => {
      const rules: ReplacementRule[] = [
        {
          id: '1',
          pattern: 'Hello',
          replacement: 'Hi',
          enabled: false,
          isRegex: false,
          order: 1,
        },
        {
          id: '2',
          pattern: 'world',
          replacement: 'universe',
          enabled: true,
          isRegex: false,
          order: 2,
        },
      ];
      const ctx = createMockContext(rules, '<p>Hello world</p>');
      const result = await replacementTransformer.transform(ctx);

      expect(result).toContain('Hello'); // Not replaced (disabled)
      expect(result).toContain('universe'); // Replaced (enabled)
    });
  });

  describe('error handling', () => {
    test('should handle invalid regex gracefully', async () => {
      const rules: ReplacementRule[] = [
        {
          id: '1',
          pattern: '[invalid',
          replacement: 'fixed',
          enabled: true,
          isRegex: true,
          order: 1,
        },
      ];
      const ctx = createMockContext(rules, '<p>Test content</p>');
      const result = await replacementTransformer.transform(ctx);

      expect(result).toContain('Test content'); // Content unchanged
    });

    test('should continue processing other rules after invalid regex', async () => {
      const rules: ReplacementRule[] = [
        {
          id: '1',
          pattern: '[invalid',
          replacement: 'fixed',
          enabled: true,
          isRegex: true,
          order: 1,
        },
        {
          id: '2',
          pattern: 'Test',
          replacement: 'PASSED',
          enabled: true,
          isRegex: false,
          order: 2,
        },
      ];
      const ctx = createMockContext(rules, '<p>Test content</p>');
      const result = await replacementTransformer.transform(ctx);

      expect(result).toContain('PASSED'); // Second rule should still work
    });
  });

  describe('HTML preservation', () => {
    test('should preserve HTML structure', async () => {
      const rules: ReplacementRule[] = [
        {
          id: '1',
          pattern: 'text',
          replacement: 'TEXT',
          enabled: true,
          isRegex: false,
          order: 1,
        },
      ];
      const ctx = createMockContext(rules, '<p>Some text here</p><span>More text</span>');
      const result = await replacementTransformer.transform(ctx);

      expect(result).toContain('<p>');
      expect(result).toContain('</p>');
      expect(result).toContain('<span>');
      expect(result).toContain('</span>');
      expect(result).toContain('TEXT');
    });

    test('should skip script and style tags', async () => {
      const rules: ReplacementRule[] = [
        {
          id: '1',
          pattern: 'text',
          replacement: 'TEXT',
          enabled: true,
          isRegex: false,
          order: 1,
        },
      ];
      const ctx = createMockContext(
        rules,
        '<p>Some text</p><script>var text = "test";</script><style>.text { color: red; }</style>',
      );
      const result = await replacementTransformer.transform(ctx);

      // Text in <p> should be replaced
      expect(result).toContain('Some TEXT');
      // Text in <script> and <style> should remain unchanged
      expect(result).toContain('var text = "test"');
      expect(result).toContain('.text { color: red; }');
    });
  });

  describe('unicode and special characters', () => {
    test('should handle unicode characters', async () => {
      const rules: ReplacementRule[] = [
        {
          id: '1',
          pattern: 'café',
          replacement: 'cafe',
          enabled: true,
          isRegex: false,
          order: 1,
          wholeWord: true,
        },
      ];
      const ctx = createMockContext(rules, '<p>café</p>');
      const result = await replacementTransformer.transform(ctx);

      expect(result).toContain('cafe');
      expect(result).not.toContain('café');
    });

    test('should handle special regex characters in simple mode', async () => {
      const rules: ReplacementRule[] = [
        {
          id: '1',
          pattern: 'a.b',
          replacement: 'A.B',
          enabled: true,
          isRegex: false, // Simple mode should escape special chars
          order: 1,
        },
      ];

      const ctx = createMockContext(rules, '<p>a.b and aXb</p>');
      const result = await replacementTransformer.transform(ctx);

      expect(result).toContain('A.B'); // Exact match replaced
      expect(result).toContain('aXb'); // Not replaced (not exact match)
    });

    test('should handle special regex characters in simple mode (single-instance)', async () => {
      const rules: ReplacementRule[] = [
        {
          id: '1',
          pattern: 'a.b',
          replacement: 'A.B',
          enabled: true,
          isRegex: false, // literal match
          singleInstance: true, // only first occurrence
          occurrenceIndex: 0, // replace only the first one
          order: 1,
        },
      ];

      const input = '<p>aXb and a.b and a.b</p>';

      const ctx = createMockContext(rules, input);
      const result = await replacementTransformer.transform(ctx);

      // Only the first literal "a.b" should be replaced → "A.B"
      expect(result).toContain('A.B and a.b'); // second "a.b" remains

      // aXb must NOT be replaced (the "." does NOT match X)
      expect(result).toContain('aXb');

      // Ensure only *one* instance was replaced
      const replacedCount = (result.match(/A\.B/g) || []).length;
      expect(replacedCount).toBe(1);
    });
  });

  describe('edge cases', () => {
    test('should handle empty pattern', async () => {
      const rules: ReplacementRule[] = [
        {
          id: '1',
          pattern: '',
          replacement: 'X',
          enabled: true,
          isRegex: false,
          order: 1,
        },
      ];
      const ctx = createMockContext(rules, '<p>test</p>');
      const result = await replacementTransformer.transform(ctx);

      // empty pattern produces no changes
      expect(result).toBe(ctx.content);
    });

    test('should handle empty replacement', async () => {
      const rules: ReplacementRule[] = [
        {
          id: '1',
          pattern: 'test',
          replacement: '',
          enabled: true,
          isRegex: false,
          order: 1,
        },
      ];
      const ctx = createMockContext(rules, '<p>test content</p>');
      const result = await replacementTransformer.transform(ctx);

      expect(result).not.toContain('test');
      expect(result).toContain(' content');
    });

    test('should handle rules with undefined order', async () => {
      const rules: ReplacementRule[] = [
        {
          id: '1',
          pattern: 'test',
          replacement: 'TEST',
          enabled: true,
          isRegex: false,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          order: undefined as any,
        },
      ];
      const ctx = createMockContext(rules, '<p>test</p>');
      const result = await replacementTransformer.transform(ctx);

      expect(result).toContain('TEST');
    });

    test('should handle complex HTML with nested elements', async () => {
      const rules: ReplacementRule[] = [
        {
          id: '1',
          pattern: 'text',
          replacement: 'TEXT',
          enabled: true,
          isRegex: false,
          order: 1,
        },
      ];
      const ctx = createMockContext(
        rules,
        '<div><p>Some text</p><span>More text <strong>here</strong></span></div>',
      );
      const result = await replacementTransformer.transform(ctx);

      expect(result).toContain('Some TEXT');
      expect(result).toContain('More TEXT');
      expect(result).toContain('<strong>');
      expect(result).toContain('</strong>');
    });
  });

  describe('logging', () => {
    test('should log transformer call with correct information', async () => {
      const rules: ReplacementRule[] = [
        {
          id: '1',
          pattern: 'test',
          replacement: 'TEST',
          enabled: true,
          isRegex: false,
          order: 1,
        },
      ];
      const ctx = createMockContext(rules, '<p>test</p>');

      await replacementTransformer.transform(ctx);
    });
  });

  describe('replacement rule management functions', () => {
    describe('createReplacementRule', () => {
      test('should create a rule with default values', () => {
        const rule = createReplacementRule({
          pattern: 'test',
          replacement: 'TEST',
        });

        expect(rule).toMatchObject({
          pattern: 'test',
          replacement: 'TEST',
          isRegex: false,
          enabled: true,
          order: 1000,
        });
        expect(rule.id).toBeDefined();
        expect(typeof rule.id).toBe('string');
      });

      test('should create a rule with custom values', () => {
        const rule = createReplacementRule({
          pattern: '\\d+',
          replacement: 'NUMBER',
          isRegex: true,
          enabled: false,
          order: 1,
        });

        expect(rule).toMatchObject({
          pattern: '\\d+',
          replacement: 'NUMBER',
          isRegex: true,
          enabled: false,
          order: 1,
        });
      });
    });

    describe('mergeReplacementRules', () => {
      test('should merge global and book rules', () => {
        const globalRules: ReplacementRule[] = [
          {
            id: 'global-1',
            pattern: 'the',
            replacement: 'THE',
            enabled: true,
            isRegex: false,
            order: 1,
          },
        ];

        const bookRules: ReplacementRule[] = [
          {
            id: 'book-1',
            pattern: 'cat',
            replacement: 'dog',
            enabled: true,
            isRegex: false,
            order: 2,
          },
        ];

        const merged = mergeReplacementRules(globalRules, bookRules);

        expect(merged).toHaveLength(2);
        expect(merged[0]!.id).toBe('global-1');
        expect(merged[1]!.id).toBe('book-1');
      });

      test('should prioritize book rules over global rules with same ID', () => {
        const globalRules: ReplacementRule[] = [
          {
            id: 'rule-1',
            pattern: 'the',
            replacement: 'THE',
            enabled: true,
            isRegex: false,
            order: 1,
          },
        ];

        const bookRules: ReplacementRule[] = [
          {
            id: 'rule-1',
            pattern: 'the',
            replacement: '>THE<',
            enabled: true,
            isRegex: false,
            order: 1,
          },
        ];

        const merged = mergeReplacementRules(globalRules, bookRules);

        expect(merged).toHaveLength(1);
        expect(merged[0]!.replacement).toBe('>THE<'); // Book rule wins
      });

      test('should sort rules by order', () => {
        const globalRules: ReplacementRule[] = [
          {
            id: 'rule-3',
            pattern: 'c',
            replacement: 'C',
            enabled: true,
            isRegex: false,
            order: 3,
          },
          {
            id: 'rule-1',
            pattern: 'a',
            replacement: 'A',
            enabled: true,
            isRegex: false,
            order: 1,
          },
        ];

        const bookRules: ReplacementRule[] = [
          {
            id: 'rule-2',
            pattern: 'b',
            replacement: 'B',
            enabled: true,
            isRegex: false,
            order: 2,
          },
        ];

        const merged = mergeReplacementRules(globalRules, bookRules);

        expect(merged[0]!.pattern).toBe('a');
        expect(merged[1]!.pattern).toBe('b');
        expect(merged[2]!.pattern).toBe('c');
      });

      test('should handle undefined rules', () => {
        const merged = mergeReplacementRules(undefined, undefined);
        expect(merged).toEqual([]);
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
});
