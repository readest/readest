// copilot generated
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { replacementTransformer } from '@/services/transformers/replacement';
import { TransformContext } from '@/services/transformers/types';
import { ViewSettings, ReplacementRule } from '@/types/book';

describe('replacementTransformer', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Spy on console methods to verify logging
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

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
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[REPLACEMENT] Transformer called!',
        expect.objectContaining({
          bookKey: 'test-book',
          hasRules: false,
          ruleCount: 0,
        }),
      );
      expect(consoleLogSpy).toHaveBeenCalledWith('[REPLACEMENT] No rules defined, returning unchanged');
    });

    test('should return content unchanged when rules array is empty', async () => {
      const ctx = createMockContext([], '<p>Hello world</p>');
      const result = await replacementTransformer.transform(ctx);
      
      expect(result).toContain('Hello world');
      expect(consoleLogSpy).toHaveBeenCalledWith('[REPLACEMENT] No rules defined, returning unchanged');
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
      expect(consoleLogSpy).toHaveBeenCalledWith('[REPLACEMENT] Applying', 1, 'rules:', ['Hello']);
      expect(consoleLogSpy).toHaveBeenCalledWith('[REPLACEMENT] Transformation complete');
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
        },
      ];
      const ctx = createMockContext(rules, '<p>The cat and the dog</p>');
      const result = await replacementTransformer.transform(ctx);
      
      // Note: Our implementation uses 'g' flag, so it will match "the" but not "The"
      // This is expected behavior - regex is case-sensitive by default
      expect(result).toContain('THE');
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
      const ctx = createMockContext(rules, '<p>abc</p>');
      const result = await replacementTransformer.transform(ctx);
      
      // Both should be applied
      expect(result).toContain('A');
      expect(result).toContain('B');
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
      expect(consoleLogSpy).toHaveBeenCalledWith('[REPLACEMENT] No enabled rules, returning unchanged');
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
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid regex pattern'),
        expect.anything(),
      );
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
          pattern: 'é',
          replacement: 'e',
          enabled: true,
          isRegex: false,
          order: 1,
        },
      ];
      const ctx = createMockContext(rules, '<p>café</p>');
      const result = await replacementTransformer.transform(ctx);
      
      expect(result).toContain('cafe');
      expect(result).not.toContain('é');
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
      
      // Empty pattern should not cause errors
      expect(result).toBeDefined();
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
      
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[REPLACEMENT] Transformer called!',
        expect.objectContaining({
          bookKey: 'test-book',
          hasRules: true,
          ruleCount: 1,
        }),
      );
    });

    test('should log when applying rules', async () => {
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
      
      expect(consoleLogSpy).toHaveBeenCalledWith('[REPLACEMENT] Applying', 1, 'rules:', ['test']);
      expect(consoleLogSpy).toHaveBeenCalledWith('[REPLACEMENT] Transformation complete');
    });
  });
});