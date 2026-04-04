import { describe, test, expect } from 'vitest';
import { diff } from '@/utils/diff';

describe('diff', () => {
  describe('identical strings', () => {
    test('returns empty string for identical single-line strings', () => {
      expect(diff('hello', 'hello')).toBe('');
    });

    test('returns empty string for identical multi-line strings', () => {
      const text = 'line one\nline two\nline three';
      expect(diff(text, text)).toBe('');
    });

    test('returns empty string when both strings are empty', () => {
      expect(diff('', '')).toBe('');
    });
  });

  describe('empty inputs', () => {
    test('all lines added when first string is empty', () => {
      const result = diff('', 'alpha\nbeta');
      expect(result).toBe('0a1,2\n> alpha\n> beta');
    });

    test('all lines deleted when second string is empty', () => {
      const result = diff('alpha\nbeta', '');
      expect(result).toBe('1,2d0\n< alpha\n< beta');
    });

    test('single line added from empty', () => {
      const result = diff('', 'only');
      expect(result).toBe('0a1\n> only');
    });

    test('single line deleted to empty', () => {
      const result = diff('only', '');
      expect(result).toBe('1d0\n< only');
    });
  });

  describe('whitespace-only lines filtered', () => {
    test('whitespace-only lines are ignored in both inputs', () => {
      const str1 = 'aaa\n   \nbbb';
      const str2 = 'aaa\n\nbbb';
      expect(diff(str1, str2)).toBe('');
    });

    test('strings differing only by blank lines produce empty result', () => {
      const str1 = 'foo\n\n\nbar';
      const str2 = 'foo\nbar';
      expect(diff(str1, str2)).toBe('');
    });

    test('tabs and spaces only lines are filtered out', () => {
      const str1 = 'hello\n\t  \t\nworld';
      const str2 = 'hello\nworld';
      expect(diff(str1, str2)).toBe('');
    });
  });

  describe('trimmed comparison', () => {
    test('leading and trailing spaces are ignored when comparing lines', () => {
      const str1 = '  hello  \n  world  ';
      const str2 = 'hello\nworld';
      expect(diff(str1, str2)).toBe('');
    });

    test('tabs are trimmed for comparison', () => {
      const str1 = '\thello\t';
      const str2 = 'hello';
      expect(diff(str1, str2)).toBe('');
    });

    test('mixed whitespace trimmed for comparison', () => {
      const str1 = '  \talpha\t  \n  beta  ';
      const str2 = 'alpha\nbeta';
      expect(diff(str1, str2)).toBe('');
    });
  });

  describe('pure additions', () => {
    test('single line added at end', () => {
      const result = diff('aaa', 'aaa\nbbb');
      expect(result).toBe('1a2\n> bbb');
    });

    test('multiple lines added at end', () => {
      const result = diff('aaa', 'aaa\nbbb\nccc');
      expect(result).toBe('1a2,3\n> bbb\n> ccc');
    });

    test('lines added at beginning', () => {
      // LCS matches 'ccc' at position 0 in both; remaining lines2 entries are additions
      const result = diff('ccc', 'aaa\nbbb\nccc');
      expect(result).toBe('1a2,3\n> bbb\n> ccc');
    });

    test('line added in the middle', () => {
      // LCS matches 'aaa' then 'ccc' at position 1; remaining 'ccc' in lines2 is an addition
      const result = diff('aaa\nccc', 'aaa\nbbb\nccc');
      expect(result).toBe('2a3\n> ccc');
    });
  });

  describe('pure deletions', () => {
    test('single line deleted from end', () => {
      const result = diff('aaa\nbbb', 'aaa');
      expect(result).toBe('2d1\n< bbb');
    });

    test('multiple lines deleted from end', () => {
      const result = diff('aaa\nbbb\nccc', 'aaa');
      expect(result).toBe('2,3d1\n< bbb\n< ccc');
    });

    test('lines deleted from beginning', () => {
      const result = diff('aaa\nbbb\nccc', 'ccc');
      expect(result).toBe('1,2d0\n< aaa\n< bbb');
    });

    test('line deleted from the middle', () => {
      const result = diff('aaa\nbbb\nccc', 'aaa\nccc');
      expect(result).toBe('2d1\n< bbb');
    });
  });

  describe('changes', () => {
    test('single line changed', () => {
      const result = diff('aaa\nbbb\nccc', 'aaa\nxxx\nccc');
      expect(result).toBe('2c2\n< bbb\n---\n> xxx');
    });

    test('multiple lines changed to same count', () => {
      const result = diff('aaa\nbbb\nccc\nddd', 'aaa\nxxx\nyyy\nddd');
      expect(result).toBe('2,3c2,3\n< bbb\n< ccc\n---\n> xxx\n> yyy');
    });

    test('fewer lines changed to more lines', () => {
      const result = diff('aaa\nbbb\nddd', 'aaa\nxxx\nyyy\nzzz\nddd');
      expect(result).toBe('2c2,4\n< bbb\n---\n> xxx\n> yyy\n> zzz');
    });

    test('more lines changed to fewer lines', () => {
      const result = diff('aaa\nbbb\nccc\nzzz\nddd', 'aaa\nxxx\nddd');
      expect(result).toBe('2,4c2\n< bbb\n< ccc\n< zzz\n---\n> xxx');
    });

    test('complete replacement of all lines', () => {
      const result = diff('aaa\nbbb', 'xxx\nyyy');
      expect(result).toBe('1,2c1,2\n< aaa\n< bbb\n---\n> xxx\n> yyy');
    });
  });

  describe('mixed operations', () => {
    test('deletion followed by addition', () => {
      const result = diff('aaa\nbbb\nccc', 'bbb\nccc\nddd');
      expect(result).toBe('1d0\n< aaa\n3a3\n> ddd');
    });

    test('addition followed by deletion', () => {
      // LCS matches 'bbb' and 'ccc'; last line differs so it becomes a change hunk
      const result = diff('bbb\nccc\nddd', 'aaa\nbbb\nccc');
      expect(result).toBe('3c3\n< ddd\n---\n> ccc');
    });

    test('change and addition', () => {
      const result = diff('aaa\nbbb', 'xxx\nbbb\nccc');
      expect(result).toBe('1c1\n< aaa\n---\n> xxx\n2a3\n> ccc');
    });

    test('change and deletion', () => {
      const result = diff('aaa\nbbb\nccc', 'xxx\nbbb');
      expect(result).toBe('1c1\n< aaa\n---\n> xxx\n3d2\n< ccc');
    });
  });

  describe('range format', () => {
    test('single line uses plain number format', () => {
      const result = diff('aaa\nbbb\nccc', 'aaa\nxxx\nccc');
      // hunk header should be "2c2" (single lines, no comma range)
      const header = result.split('\n')[0];
      expect(header).toBe('2c2');
    });

    test('multiple lines use N,M range format', () => {
      const result = diff('aaa\nbbb\nccc\nddd', 'aaa\nxxx\nyyy\nddd');
      const header = result.split('\n')[0];
      expect(header).toBe('2,3c2,3');
    });
  });

  describe('output format details', () => {
    test('deleted lines prefixed with "< "', () => {
      const result = diff('aaa\nbbb', 'aaa');
      expect(result).toContain('< bbb');
    });

    test('added lines prefixed with "> "', () => {
      const result = diff('aaa', 'aaa\nbbb');
      expect(result).toContain('> bbb');
    });

    test('change hunks contain "---" separator', () => {
      const result = diff('aaa', 'bbb');
      const lines = result.split('\n');
      expect(lines).toContain('---');
    });

    test('deletion hunks do not contain "---" separator', () => {
      const result = diff('aaa\nbbb', 'aaa');
      expect(result).not.toContain('---');
    });

    test('addition hunks do not contain "---" separator', () => {
      const result = diff('aaa', 'aaa\nbbb');
      expect(result).not.toContain('---');
    });
  });
});
