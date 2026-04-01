import { describe, test, expect } from 'vitest';
import { validateCSS, formatCSS } from '@/utils/css';

describe('validateCSS', () => {
  describe('valid CSS', () => {
    test('accepts a single rule with one declaration', () => {
      const result = validateCSS('body { color: red; }');
      expect(result).toEqual({ isValid: true, error: null });
    });

    test('accepts a single rule with multiple declarations', () => {
      const result = validateCSS('body { color: red; font-size: 16px; margin: 0 auto; }');
      expect(result).toEqual({ isValid: true, error: null });
    });

    test('accepts multiple rules', () => {
      const css = `
        body { color: red; }
        h1 { font-size: 24px; }
        .container { margin: 0 auto; padding: 10px; }
      `;
      const result = validateCSS(css);
      expect(result).toEqual({ isValid: true, error: null });
    });

    test('accepts complex selectors', () => {
      const css = `
        div > p.intro:first-child { color: blue; }
        ul li a[href^="https"] { text-decoration: none; }
        #main .content ~ aside { width: 200px; }
      `;
      const result = validateCSS(css);
      expect(result).toEqual({ isValid: true, error: null });
    });

    test('accepts declarations without trailing semicolons', () => {
      const result = validateCSS('body { color: red }');
      expect(result).toEqual({ isValid: true, error: null });
    });

    test('accepts vendor-prefixed properties', () => {
      const result = validateCSS(
        'div { -webkit-transform: rotate(45deg); -moz-user-select: none; }',
      );
      expect(result).toEqual({ isValid: true, error: null });
    });

    test('accepts custom properties (CSS variables)', () => {
      const result = validateCSS(':root { --main-color: #333; }');
      expect(result).toEqual({ isValid: true, error: null });
    });
  });

  describe('at-rules', () => {
    test('accepts @media with nested rules', () => {
      const css = '@media (max-width: 768px) { body { font-size: 14px; } }';
      const result = validateCSS(css);
      expect(result).toEqual({ isValid: true, error: null });
    });

    test('accepts @media with multiple nested rules', () => {
      const css = `
        @media screen and (min-width: 1024px) {
          .container { max-width: 960px; }
          .sidebar { display: block; }
        }
      `;
      const result = validateCSS(css);
      expect(result).toEqual({ isValid: true, error: null });
    });

    test('accepts @keyframes at-rule', () => {
      const css = '@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }';
      const result = validateCSS(css);
      expect(result).toEqual({ isValid: true, error: null });
    });

    test('accepts at-rules mixed with regular rules', () => {
      const css = `
        body { margin: 0; }
        @media (max-width: 600px) {
          body { padding: 10px; }
        }
        h1 { font-size: 2em; }
      `;
      const result = validateCSS(css);
      expect(result).toEqual({ isValid: true, error: null });
    });

    test('rejects at-rule with invalid inner content', () => {
      const css = '@media screen { { color: red; } }';
      const result = validateCSS(css);
      expect(result.isValid).toBe(false);
    });
  });

  describe('comments', () => {
    test('strips comments and validates the remaining CSS', () => {
      const css = '/* header styles */ h1 { color: blue; }';
      const result = validateCSS(css);
      expect(result).toEqual({ isValid: true, error: null });
    });

    test('strips multi-line comments', () => {
      const css = `
        /* This is a
           multi-line comment */
        p { line-height: 1.5; }
      `;
      const result = validateCSS(css);
      expect(result).toEqual({ isValid: true, error: null });
    });

    test('strips inline comments between declarations', () => {
      const css = 'div { color: red; /* text color */ font-size: 14px; }';
      const result = validateCSS(css);
      expect(result).toEqual({ isValid: true, error: null });
    });

    test('returns empty error for comment-only input', () => {
      const result = validateCSS('/* just a comment */');
      expect(result).toEqual({ isValid: false, error: 'Empty CSS' });
    });
  });

  describe('empty input', () => {
    test('rejects empty string', () => {
      const result = validateCSS('');
      expect(result).toEqual({ isValid: false, error: 'Empty CSS' });
    });

    test('rejects whitespace-only string', () => {
      const result = validateCSS('   \n\t  ');
      expect(result).toEqual({ isValid: false, error: 'Empty CSS' });
    });
  });

  describe('unbalanced braces', () => {
    test('rejects missing closing brace', () => {
      const result = validateCSS('body { color: red;');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Unbalanced curly braces');
    });

    test('rejects extra closing brace', () => {
      const result = validateCSS('body { color: red; } }');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Unbalanced curly braces');
    });

    test('rejects missing opening brace', () => {
      const result = validateCSS('body color: red; }');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Unbalanced curly braces');
    });

    test('rejects multiple unbalanced braces', () => {
      const result = validateCSS('body { color: red; h1 { font-size: 16px; }');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Unbalanced curly braces');
    });
  });

  describe('missing selector', () => {
    test('rejects rule with empty selector', () => {
      const result = validateCSS('{ color: red; }');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Missing selector');
    });
  });

  describe('missing declarations', () => {
    test('rejects rule with empty declaration block', () => {
      const result = validateCSS('body { }');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Missing declarations');
    });

    test('rejects rule with only whitespace in declarations', () => {
      const result = validateCSS('body {   }');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Missing declarations');
    });
  });

  describe('missing property name or value', () => {
    test('rejects declaration missing colon (no property/value separation)', () => {
      const result = validateCSS('body { color }');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Missing property or value');
    });

    test('rejects declaration with empty property name', () => {
      const result = validateCSS('body { : red; }');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Missing property name');
    });

    test('rejects declaration with empty value', () => {
      const result = validateCSS('body { color: ; }');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Missing property value');
    });
  });

  describe('invalid property format', () => {
    test('rejects property name with invalid characters', () => {
      const result = validateCSS('body { col or: red; }');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Invalid property');
    });

    test('accepts property name starting with a number (matches \\w pattern)', () => {
      // The property pattern uses [-\w]+ which allows digits, so numeric-prefixed names pass
      const result = validateCSS('body { 123color: red; }');
      expect(result).toEqual({ isValid: true, error: null });
    });
  });
});

describe('formatCSS', () => {
  describe('basic formatting', () => {
    test('formats a single rule with proper indentation', () => {
      const css = 'body{color:red;}';
      const result = formatCSS(css);
      expect(result).toContain('body {');
      expect(result).toContain('\tcolor:red;');
      expect(result).toContain('}');
    });

    test('formats multiple rules on separate lines', () => {
      const css = 'body{color:red;}h1{font-size:24px;}';
      const result = formatCSS(css);
      expect(result).toContain('body {');
      expect(result).toContain('h1 {');
      // Each rule should have its closing brace
      const closingBraces = result.match(/^}/gm);
      expect(closingBraces?.length).toBe(2);
    });

    test('collapses extra whitespace and newlines', () => {
      const css = 'body  {  color:    red;   font-size:   16px;  }';
      const result = formatCSS(css);
      // Should not have consecutive spaces (except for indentation)
      expect(result).not.toMatch(/ {2,}/);
    });
  });

  describe('comment preservation', () => {
    test('preserves comments in the output', () => {
      const css = '/* main styles */ body { color: red; }';
      const result = formatCSS(css);
      expect(result).toContain('/* main styles */');
    });

    test('preserves multi-line comments', () => {
      const css = '/* first line\nsecond line */ body { color: red; }';
      const result = formatCSS(css);
      expect(result).toContain('/*');
      expect(result).toContain('*/');
    });
  });

  describe('nested rules', () => {
    test('formats nested at-rules with correct indentation depth', () => {
      const css = '@media (max-width: 768px){body{font-size:14px;}}';
      const result = formatCSS(css);
      expect(result).toContain('@media (max-width: 768px) {');
      expect(result).toContain('\tbody {');
      expect(result).toContain('\t\tfont-size:14px;');
    });

    test('formats deeply nested rules', () => {
      const css = '@media screen{@supports (display: grid){.container{display:grid;}}}';
      const result = formatCSS(css);
      // Verify increasing depth
      expect(result).toContain('@media screen {');
      expect(result).toContain('\t@supports (display: grid) {');
      expect(result).toContain('\t\t.container {');
      expect(result).toContain('\t\t\tdisplay:grid;');
    });
  });

  describe('semicolon insertion', () => {
    test('inserts missing semicolon before closing brace', () => {
      const css = 'body { color: red }';
      const result = formatCSS(css);
      // The pre-processing regex inserts a semicolon before }, so `;` appears after the value
      expect(result).toContain(';');
      expect(result).toMatch(/red\s*;/);
    });

    test('does not double semicolons when already present', () => {
      const css = 'body { color: red; }';
      const result = formatCSS(css);
      expect(result).not.toMatch(/;;/);
    });

    test('handles multiple declarations with missing semicolons', () => {
      // The last declaration before } gets the semicolon inserted by the pre-processing regex
      const css = 'body { color: red; font-size: 16px }';
      const result = formatCSS(css);
      expect(result).toMatch(/16px\s*;/);
    });
  });

  describe('round-trip consistency', () => {
    test('second formatting pass is stable (idempotent after two passes)', () => {
      const css = 'body { color: red; font-size: 16px; }';
      const first = formatCSS(css);
      const second = formatCSS(first);
      const third = formatCSS(second);
      // The second pass normalizes any residual spacing; after that it should be stable
      expect(third).toBe(second);
    });
  });
});
