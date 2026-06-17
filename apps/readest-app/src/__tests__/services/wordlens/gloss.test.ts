import { describe, it, expect } from 'vitest';
import { cleanGloss, baseFormCandidates, glossesShareMeaning } from '@/services/wordlens/gloss';

describe('cleanGloss', () => {
  it('strips a leading interj. POS tag (6 letters)', () => {
    expect(cleanGloss('interj. 呃哼')).toBe('呃哼');
  });

  it('strips short leading POS tags', () => {
    expect(cleanGloss('a. 神秘的')).toBe('神秘的');
    expect(cleanGloss('vt. 做；vi. 看')).toBe('做');
  });

  it('keeps only the first sense (comma- or semicolon-separated)', () => {
    expect(cleanGloss('内心的, 向内的, 本来的；向内的')).toBe('内心的');
    expect(cleanGloss('to run, to operate, to manage')).toBe('to run');
  });

  it('leaves a single short sense unchanged, including a trailing 的', () => {
    expect(cleanGloss('向下')).toBe('向下');
    expect(cleanGloss('晦涩的')).toBe('晦涩的');
  });

  it('returns empty string for empty input', () => {
    expect(cleanGloss('')).toBe('');
  });
});

describe('baseFormCandidates', () => {
  it('over-generates base forms for transparent derivations', () => {
    expect(baseFormCandidates('lazily')).toContain('lazy');
    expect(baseFormCandidates('shyly')).toContain('shy');
    expect(baseFormCandidates('sorrowful')).toContain('sorrow');
    expect(baseFormCandidates('downwards')).toContain('downward');
    expect(baseFormCandidates('inwards')).toContain('inward');
  });

  it('returns no candidates for a non-derived word', () => {
    expect(baseFormCandidates('cryptic')).toEqual([]);
  });
});

describe('glossesShareMeaning', () => {
  it('is true when two CJK glosses share a content character', () => {
    expect(glossesShareMeaning('懒洋洋地', '懒惰的, 怠惰的')).toBe(true);
    expect(glossesShareMeaning('向下', '向下的')).toBe(true);
  });

  it('is false when a derived gloss has drifted from its base', () => {
    expect(glossesShareMeaning('几乎不', '坚硬的, 硬的')).toBe(false); // hardly vs hard
    expect(glossesShareMeaning('近来', '迟的, 晚的')).toBe(false); // lately vs late
  });
});
