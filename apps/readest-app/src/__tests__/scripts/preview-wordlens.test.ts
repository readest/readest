import { describe, it, expect } from 'vitest';
import { sampleEntries as sampleEntriesUntyped } from '../../../scripts/preview-wordlens.mjs';

type Entry = { r: number; g: string };
const sampleEntries = sampleEntriesUntyped as (
  entries: Record<string, Entry>,
  count?: number,
) => [string, Entry][];

describe('sampleEntries', () => {
  it('returns all entries rank-sorted (ascending) when count >= size', () => {
    const e = { b: { r: 20, g: 'B' }, a: { r: 10, g: 'A' } };
    expect(sampleEntries(e, 5).map(([w]) => w)).toEqual(['a', 'b']);
  });

  it('spreads samples across the rank range — commonest first, rarest last', () => {
    const e: Record<string, Entry> = {};
    for (let i = 1; i <= 100; i++) e[`w${i}`] = { r: i, g: `g${i}` };
    const s = sampleEntries(e, 5);
    expect(s.length).toBe(5);
    expect(s[0]![1].r).toBe(1); // most common
    expect(s[4]![1].r).toBe(100); // rarest
    const ranks = s.map(([, v]) => v.r);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks); // non-decreasing
  });
});
