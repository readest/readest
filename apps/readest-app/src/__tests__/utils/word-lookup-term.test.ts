import { describe, it, expect } from 'vitest';
import { isSingleLookupTerm } from '../../utils/word';

describe('isSingleLookupTerm', () => {
  it('rejects empty and whitespace-only text', () => {
    expect(isSingleLookupTerm('')).toBe(false);
    expect(isSingleLookupTerm('   ')).toBe(false);
    expect(isSingleLookupTerm('\n\t')).toBe(false);
  });

  it('accepts a single word in space-delimited scripts', () => {
    expect(isSingleLookupTerm('serendipity')).toBe(true);
    expect(isSingleLookupTerm('café')).toBe(true);
    expect(isSingleLookupTerm("don't")).toBe(true);
    expect(isSingleLookupTerm('mother-in-law')).toBe(true);
    expect(isSingleLookupTerm('  hello  ')).toBe(true);
  });

  it('rejects multi-word selections in space-delimited scripts', () => {
    expect(isSingleLookupTerm('hello world')).toBe(false);
    expect(isSingleLookupTerm('the quick brown fox jumps')).toBe(false);
    expect(isSingleLookupTerm('hello\nworld')).toBe(false);
    expect(isSingleLookupTerm('hello world')).toBe(false);
  });

  it('accepts short CJK words, compounds, and idioms', () => {
    expect(isSingleLookupTerm('你好')).toBe(true);
    expect(isSingleLookupTerm('图书馆')).toBe(true);
    expect(isSingleLookupTerm('四面楚歌')).toBe(true);
    expect(isSingleLookupTerm('中华人民共和国')).toBe(true);
    expect(isSingleLookupTerm('素晴らしい')).toBe(true);
    expect(isSingleLookupTerm('コンピューター')).toBe(true);
    expect(isSingleLookupTerm('走り出した')).toBe(true);
    expect(isSingleLookupTerm('안녕하세요')).toBe(true);
  });

  it('accepts CJK terms up to 8 characters and rejects longer runs', () => {
    expect(isSingleLookupTerm('一二三四五六七八')).toBe(true);
    expect(isSingleLookupTerm('一二三四五六七八九')).toBe(false);
    expect(isSingleLookupTerm('我今天下午去了图书馆看书')).toBe(false);
    expect(isSingleLookupTerm('今日は本を読みました')).toBe(false);
  });

  it('counts CJK length in code points, not UTF-16 units', () => {
    expect(isSingleLookupTerm('𠮷野家')).toBe(true);
    expect(isSingleLookupTerm('𠮷'.repeat(9))).toBe(false);
  });

  it('rejects CJK selections containing whitespace or punctuation', () => {
    expect(isSingleLookupTerm('你好 世界')).toBe(false);
    expect(isSingleLookupTerm('你好　世界')).toBe(false);
    expect(isSingleLookupTerm('你好，世界')).toBe(false);
    expect(isSingleLookupTerm('読みました。')).toBe(false);
    expect(isSingleLookupTerm('안녕하세요 세계')).toBe(false);
  });

  it('accepts short mixed CJK/Latin terms', () => {
    expect(isSingleLookupTerm('iPhone手机')).toBe(true);
  });
});
