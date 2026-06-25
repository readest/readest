import { describe, test, expect } from 'vitest';
import type { ProofreadRule } from '@/types/book';
import { ensureRuleId, mergeProofreadRules } from '@/utils/proofread';

function rule(overrides: Partial<ProofreadRule> = {}): ProofreadRule {
  return {
    id: 'r1',
    scope: 'book',
    pattern: 'foo',
    replacement: 'bar',
    isRegex: false,
    enabled: true,
    caseSensitive: true,
    order: 1000,
    wholeWord: true,
    onlyForTTS: false,
    ...overrides,
  };
}

describe('mergeProofreadRules', () => {
  test('unions rules with disjoint ids', () => {
    const local = [rule({ id: 'a' })];
    const remote = [rule({ id: 'b' })];
    const merged = mergeProofreadRules(local, remote);
    expect(merged.map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  test('same id: remote wins when its updatedAt is newer', () => {
    const local = [rule({ id: 'a', replacement: 'local', updatedAt: 100 })];
    const remote = [rule({ id: 'a', replacement: 'remote', updatedAt: 200 })];
    const merged = mergeProofreadRules(local, remote);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.replacement).toBe('remote');
  });

  test('same id: local wins when its updatedAt is newer', () => {
    const local = [rule({ id: 'a', replacement: 'local', updatedAt: 300 })];
    const remote = [rule({ id: 'a', replacement: 'remote', updatedAt: 200 })];
    const merged = mergeProofreadRules(local, remote);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.replacement).toBe('local');
  });

  test('remote deletion (tombstone) wins over an older local edit', () => {
    const local = [rule({ id: 'a', updatedAt: 100, deletedAt: null })];
    const remote = [rule({ id: 'a', updatedAt: 100, deletedAt: 200 })];
    const merged = mergeProofreadRules(local, remote);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.deletedAt).toBe(200);
  });

  test('a deleted rule is not resurrected by a stale peer copy', () => {
    // Device A deleted the rule (tombstone). Device B still has the live copy.
    const localDeleted = [rule({ id: 'a', updatedAt: 50, deletedAt: 300 })];
    const remoteLive = [rule({ id: 'a', updatedAt: 50, deletedAt: null })];
    const merged = mergeProofreadRules(localDeleted, remoteLive);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.deletedAt).toBe(300);
  });

  test('treats missing updatedAt as 0 and keeps the local copy on a tie', () => {
    const local = [rule({ id: 'a', replacement: 'local' })];
    const remote = [rule({ id: 'a', replacement: 'remote' })];
    const merged = mergeProofreadRules(local, remote);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.replacement).toBe('local');
  });

  test('handles empty inputs', () => {
    expect(mergeProofreadRules([], [])).toEqual([]);
    expect(mergeProofreadRules([rule({ id: 'a' })], [])).toHaveLength(1);
    expect(mergeProofreadRules([], [rule({ id: 'b' })])).toHaveLength(1);
  });

  // Rules with no id (legacy / hand-edited / foreign sync peer). Without
  // backfilling a content-based id they would all collide on the Map's
  // `undefined` key — distinct rules would clobber each other (silent loss),
  // not duplicate.
  test('two id-less identical rules merge to one', () => {
    const local = [rule({ id: '', scope: 'book', pattern: 'teh', replacement: 'the' })];
    const remote = [rule({ id: '', scope: 'book', pattern: 'teh', replacement: 'the' })];
    const merged = mergeProofreadRules(local, remote);
    expect(merged).toHaveLength(1);
  });

  test('two id-less DIFFERENT rules across sides are both kept', () => {
    const local = [rule({ id: '', scope: 'book', pattern: 'teh' })];
    const remote = [rule({ id: '', scope: 'book', pattern: 'recieve' })];
    const merged = mergeProofreadRules(local, remote);
    expect(merged.map((r) => r.pattern).sort()).toEqual(['recieve', 'teh']);
  });

  test('two DIFFERENT id-less rules on the SAME side are both kept (no undefined-key collapse)', () => {
    const local = [
      rule({ id: '', scope: 'book', pattern: 'teh' }),
      rule({ id: '', scope: 'book', pattern: 'recieve' }),
    ];
    const merged = mergeProofreadRules(local, []);
    expect(merged).toHaveLength(2);
  });
});

describe('ensureRuleId', () => {
  test('backfills a missing id deterministically from content', () => {
    const a = ensureRuleId(rule({ id: '', scope: 'book', pattern: 'teh', replacement: 'the' }));
    const b = ensureRuleId(rule({ id: '', scope: 'book', pattern: 'teh', replacement: 'THE' }));
    expect(a.id).toBeTruthy();
    // Identity mirrors the in-store dedup (scope + pattern + isRegex); the
    // replacement is NOT part of it, so the same pattern collapses to one id.
    expect(b.id).toBe(a.id);
  });

  test('a different pattern / scope / isRegex yields a different id', () => {
    const base = ensureRuleId(rule({ id: '', scope: 'book', pattern: 'teh' })).id;
    expect(ensureRuleId(rule({ id: '', scope: 'book', pattern: 'other' })).id).not.toBe(base);
    expect(ensureRuleId(rule({ id: '', scope: 'library', pattern: 'teh' })).id).not.toBe(base);
    expect(
      ensureRuleId(rule({ id: '', scope: 'book', pattern: 'teh', isRegex: true })).id,
    ).not.toBe(base);
  });

  test('leaves an existing id untouched', () => {
    expect(ensureRuleId(rule({ id: 'fixed' })).id).toBe('fixed');
  });
});
