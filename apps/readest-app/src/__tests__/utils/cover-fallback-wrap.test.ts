import { describe, expect, test } from 'vitest';
import { wrapCoverText } from '@/utils/cover';

// One unit per character keeps the expected breaks easy to read.
const measure = (s: string) => Array.from(s).length;

describe('wrapCoverText', () => {
  test('breaks at spaces', () => {
    expect(wrapCoverText('The Old Man and the Sea', 10, 4, measure)).toEqual([
      'The Old',
      'Man and',
      'the Sea',
    ]);
  });

  test('breaks between characters when there are no spaces', () => {
    expect(wrapCoverText('三体地球往事三部曲', 4, 4, measure)).toEqual([
      '三体地球',
      '往事三部',
      '曲',
    ]);
  });

  test('splits a word wider than a line', () => {
    expect(wrapCoverText('Supercalifragilistic day', 8, 4, measure)).toEqual([
      'Supercal',
      'ifragili',
      'stic day',
    ]);
  });

  test('ends the last line with an ellipsis when the text does not fit', () => {
    expect(wrapCoverText('one two three four five six', 9, 2, measure)).toEqual([
      'one two',
      'three…',
    ]);
    expect(wrapCoverText('三体地球往事三部曲', 4, 2, measure)).toEqual(['三体地球', '往事三…']);
  });

  test('collapses whitespace and keeps short text on one line', () => {
    expect(wrapCoverText('  Short\n  title ', 20, 3, measure)).toEqual(['Short title']);
  });
});
