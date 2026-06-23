import { describe, it, expect } from 'vitest';
import { cleanGloss, baseFormCandidates, glossesShareMeaning } from '@/services/wordlens/gloss';

describe('cleanGloss', () => {
  it('strips a leading interj. POS tag (6 letters)', () => {
    expect(cleanGloss('interj. 呃哼')).toBe('呃哼');
  });

  it('strips short leading POS tags (per sense)', () => {
    expect(cleanGloss('a. 神秘的')).toBe('神秘的');
    expect(cleanGloss('vt. 做；vi. 看')).toBe('做；看'); // two senses, POS stripped from each
  });

  it('keeps the first synonym of each of the first two senses', () => {
    // ";" separates senses; "," / "、" separate near-synonyms within a sense.
    expect(cleanGloss('内心的, 向内的, 本来的；向内的')).toBe('内心的；向内的');
    expect(cleanGloss('阻止, 监禁, 拘留；隔离, 拘留, 滞留, 停')).toBe('阻止；隔离');
    expect(cleanGloss('to run, to operate, to manage')).toBe('to run'); // single sense → first synonym
    expect(cleanGloss('天的, 天国的；天的, 天空的')).toBe('天的'); // dedupe shared first synonym
  });

  it('leaves a single short sense unchanged, including a trailing 的', () => {
    expect(cleanGloss('向下')).toBe('向下');
    expect(cleanGloss('晦涩的')).toBe('晦涩的');
  });

  it('returns empty string for empty input', () => {
    expect(cleanGloss('')).toBe('');
  });

  it('preserves the build-formatted gloss for monolingual (en-en) packs', () => {
    // en-en glosses keep their full shape (≤2 senses joined by "; "); monolingual
    // mode must NOT split on ";" or drop a synonym — only normalize whitespace.
    expect(cleanGloss('to begin; to start', true)).toBe('to begin; to start');
    // non-monolingual reprocesses into ≤2 senses joined by "；" (fullwidth)
    expect(cleanGloss('to begin; to start')).toBe('to begin；to start');
  });

  it('applies the display length cap (the packs store the full hint)', () => {
    // monolingual: caps with an ellipsis instead of splitting/reprocessing.
    expect(cleanGloss('having a hidden meaning; mysterious', true)).toBe(
      'having a hidden meaning…',
    );
    // a hint already within the cap is unchanged.
    expect(cleanGloss('having a hidden meaning…', true)).toBe('having a hidden meaning…');
    // cross-lingual: after sense/synonym reduction the (single, long) result is also capped.
    const long = '啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊'; // 26 chars, no separators
    expect(cleanGloss(long).length).toBe(24);
    expect(cleanGloss(long).endsWith('…')).toBe(true);
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

  it('over-generates base forms for -able / -ible and negative-prefix derivations', () => {
    expect(baseFormCandidates('comfortable')).toContain('comfort');
    expect(baseFormCandidates('sensible')).toContain('sense');
    expect(baseFormCandidates('unhappy')).toContain('happy');
    expect(baseFormCandidates('insufferable')).toContain('suffer'); // strip -able then in-
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
