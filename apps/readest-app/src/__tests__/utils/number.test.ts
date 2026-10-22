import { describe, expect, it } from 'vitest';
import { localizeNumber } from '@/utils/number';

describe('localizeNumber', () => {
  it.each([
    [2, '两'],
    [12, '一十二'],
    [20, '二十'],
    [22, '二十二'],
    [200, '两百'],
    [1002, '一千零二'],
    [2000, '两千'],
    [12000, '一万两千'],
    [20000, '两万'],
    [220000, '二十二万'],
  ])('writes %i as %s in Simplified Chinese', (num, expected) => {
    expect(localizeNumber(num, 'zh-CN')).toBe(expected);
  });

  it.each([
    [2, '兩'],
    [12, '壹拾貳'],
    [20, '貳拾'],
    [200, '兩佰'],
    [12000, '壹萬兩仟'],
    [220000, '貳拾貳萬'],
  ])('writes %i as %s in Traditional Chinese', (num, expected) => {
    expect(localizeNumber(num, 'zh-TW')).toBe(expected);
  });

  it('keeps 二 in index numerals', () => {
    expect(localizeNumber(200, 'zh-CN', true)).toBe('二百');
  });
});
