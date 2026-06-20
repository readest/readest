import { describe, it, expect } from 'vitest';
import { planGlosses } from '@/services/wordlens/planner';
import { GlossIndex } from '@/services/wordlens/glossIndex';
import { getRankCutoff } from '@/services/wordlens/difficulty';
import type { GlossSource, GlossEntry, GlossIndexData } from '@/services/wordlens/types';
import zhEnFixture from '../../fixtures/wordlens/zh-en.fixture.json';

const source: GlossSource = {
  lookup(word) {
    const table: Record<string, GlossEntry> = {
      cryptic: { rank: 18000, gloss: '晦涩的' },
      running: { rank: 312, gloss: '跑' },
      the: { rank: 1, gloss: '这' },
      斟酌: { rank: 9000, gloss: 'to consider' },
    };
    return table[word.toLowerCase()] ?? table[word] ?? null;
  },
};

describe('planGlosses (English)', () => {
  it('glosses words at/above the cutoff with correct offsets', () => {
    const text = 'A cryptic note.';
    const occ = planGlosses(text, source, { sourceLang: 'en', rankCutoff: 7000 });
    expect(occ).toEqual([{ start: 2, end: 9, word: 'cryptic', gloss: '晦涩的' }]);
    expect(text.slice(2, 9)).toBe('cryptic');
  });
  it('skips words below the cutoff', () => {
    const occ = planGlosses('the cryptic', source, { sourceLang: 'en', rankCutoff: 7000 });
    expect(occ.map((o) => o.word)).toEqual(['cryptic']);
  });
  it('respects the per-call occurrence cap', () => {
    const occ = planGlosses('cryptic cryptic cryptic', source, {
      sourceLang: 'en',
      rankCutoff: 7000,
      maxOccurrences: 2,
    });
    expect(occ).toHaveLength(2);
  });
});

describe('planGlosses (Chinese)', () => {
  it('uses the injected segmenter and locates segments by cursor', () => {
    const text = '请你斟酌一下';
    const cutZh = (t: string) => ['请', '你', '斟酌', '一下'].filter((w) => t.includes(w));
    const occ = planGlosses(text, source, {
      sourceLang: 'zh',
      rankCutoff: 7000,
      cutZh,
    });
    expect(occ).toEqual([{ start: 2, end: 4, word: '斟酌', gloss: 'to consider' }]);
    expect(text.slice(2, 4)).toBe('斟酌');
  });
});

describe('planGlosses derivational reduction (English source)', () => {
  // A derived word inherits its base's (lower) rank when the base exists and
  // their glosses share meaning — so it drops below the cutoff and isn't hinted.
  const derv: GlossSource = {
    lookup(word) {
      const table: Record<string, GlossEntry> = {
        lazily: { rank: 16150, gloss: '懒洋洋地' },
        lazy: { rank: 6238, gloss: '懒惰的, 怠惰的' },
        // hardly is artificially rare here to prove the gloss-overlap gate (not rank) keeps it.
        hardly: { rank: 16000, gloss: '几乎不' },
        hard: { rank: 438, gloss: '坚硬的, 硬的' },
        ahem: { rank: 24471, gloss: 'interj. 呃哼' },
      };
      return table[word.toLowerCase()] ?? null;
    },
  };
  const cutoff = 14000; // ~C1

  it('suppresses a transparent derivation whose base is known (lazily ⇐ lazy)', () => {
    expect(planGlosses('lazily', derv, { sourceLang: 'en', rankCutoff: cutoff })).toEqual([]);
  });

  it('keeps a drifted derivation even when its base is common (hardly ≠ hard)', () => {
    const occ = planGlosses('hardly', derv, { sourceLang: 'en', rankCutoff: cutoff });
    expect(occ.map((o) => o.word)).toEqual(['hardly']);
  });

  it('cleans the displayed gloss (strips interj., keeps first sense)', () => {
    const occ = planGlosses('ahem', derv, { sourceLang: 'en', rankCutoff: cutoff });
    expect(occ[0]?.gloss).toBe('呃哼');
  });
});

describe('planGlosses against a zh-en fixture', () => {
  // Decoupled from the shipping data/wordlens/zh-en.json: the committed pack is
  // (re)generated from real corpora, so the test owns its ranks via a fixture.
  const data = zhEnFixture as GlossIndexData;
  const index = GlossIndex.fromData(data);

  // A real headword from the committed starter set + its rank.
  const word = '斟酌';
  const entry = data.entries[word]!;
  // Stub segmenter that segments the starter word out of the sentence.
  const cutZh = (t: string) => ['请', '你', word, '一下'].filter((w) => t.includes(w));
  const text = `请你${word}一下`;

  it('glosses the fixture word at a beginner level (A1 => most hints, low cutoff)', () => {
    const occ = planGlosses(text, index, {
      sourceLang: 'zh',
      rankCutoff: getRankCutoff('zh', 1), // A1
      cutZh,
    });
    expect(occ.map((o) => o.word)).toContain(word);
    expect(occ.find((o) => o.word === word)?.gloss).toBe(entry.g);
  });

  it('does NOT gloss it at an advanced level (C2 => fewest hints, high cutoff)', () => {
    const cutoff = getRankCutoff('zh', 6); // C2
    // Guard: the fixture word must sit below the C2 cutoff for this to be meaningful.
    expect(entry.r).toBeLessThan(cutoff);
    const occ = planGlosses(text, index, { sourceLang: 'zh', rankCutoff: cutoff, cutZh });
    expect(occ.map((o) => o.word)).not.toContain(word);
  });
});
