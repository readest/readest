import { describe, expect, test } from 'vitest';
import {
  findExistingDictionaryMatches,
  findTombstonedDictionaryMatches,
  preserveLiveDictionaryState,
  preserveUserCustomName,
  shouldMintReincarnationForLiveReimport,
} from '@/services/dictionaries/dictionaryDedup';
import type { ImportedDictionary } from '@/services/dictionaries/types';

const baseDict = (overrides: Partial<ImportedDictionary> = {}): ImportedDictionary => ({
  id: 'bundle-1',
  contentId: 'content-hash-A',
  kind: 'mdict',
  name: 'Webster Original',
  bundleDir: 'bundle-1',
  files: { mdx: 'webster.mdx' },
  addedAt: 0,
  ...overrides,
});

describe('findExistingDictionaryMatches', () => {
  test('matches by contentId when both incoming and existing have it', () => {
    const existing = [baseDict({ id: 'old', name: 'Webster Original' })];
    const incoming = baseDict({ id: 'new', name: 'Webster Original' });
    expect(findExistingDictionaryMatches(incoming, existing)).toEqual(existing);
  });

  test('matches by contentId even when the user has renamed the existing entry', () => {
    // Bug repro: user renamed the dict. Re-importing the same file produces
    // a fresh dict whose .name matches the bundle's parsed Title (the
    // ORIGINAL name), not the user's new label. ContentId-based match catches
    // it; name-based match would not.
    const renamed = baseDict({
      id: 'old',
      contentId: 'content-hash-A',
      name: 'My Renamed Dict',
    });
    const incoming = baseDict({
      id: 'new',
      contentId: 'content-hash-A',
      name: 'Webster Original',
    });
    expect(findExistingDictionaryMatches(incoming, [renamed])).toEqual([renamed]);
  });

  test('contentId mismatch with name match: still matches by name (legacy fallback)', () => {
    // Legacy bundle: existing dict has no contentId; incoming has one.
    // The legacy entry's name is the only signal we have to dedup.
    const legacy = baseDict({
      id: 'old',
      contentId: undefined,
      name: 'Webster Original',
    });
    const incoming = baseDict({
      id: 'new',
      contentId: 'content-hash-A',
      name: 'Webster Original',
    });
    expect(findExistingDictionaryMatches(incoming, [legacy])).toEqual([legacy]);
  });

  test('different contentId + same name does NOT match (different file with same Title)', () => {
    const existing = baseDict({ id: 'old', contentId: 'content-hash-A', name: 'Webster' });
    const incoming = baseDict({ id: 'new', contentId: 'content-hash-B', name: 'Webster' });
    expect(findExistingDictionaryMatches(incoming, [existing])).toEqual([]);
  });

  test('soft-deleted entries are not considered matches', () => {
    const deleted = baseDict({ id: 'old', deletedAt: Date.now() });
    const incoming = baseDict({ id: 'new' });
    expect(findExistingDictionaryMatches(incoming, [deleted])).toEqual([]);
  });

  test('returns all existing entries with the same contentId (multi-import history)', () => {
    const a = baseDict({ id: 'old-1', contentId: 'content-hash-A' });
    const b = baseDict({ id: 'old-2', contentId: 'content-hash-A' });
    const incoming = baseDict({ id: 'new', contentId: 'content-hash-A' });
    expect(findExistingDictionaryMatches(incoming, [a, b])).toEqual([a, b]);
  });

  test('returns all existing entries with the same name (multi-import legacy)', () => {
    const a = baseDict({ id: 'old-1', contentId: undefined, name: 'Webster' });
    const b = baseDict({ id: 'old-2', contentId: undefined, name: 'Webster' });
    const incoming = baseDict({ id: 'new', contentId: 'content-hash-A', name: 'Webster' });
    expect(findExistingDictionaryMatches(incoming, [a, b])).toEqual([a, b]);
  });

  test('incoming without contentId only matches existing entries that also lack contentId', () => {
    // Asymmetry: an existing entry with contentId is "tier-1 identity" — we
    // know its content hash. An incoming bundle without contentId is "tier-0".
    // Matching across tiers risks false positives (different file with same
    // Title), so we match only within the legacy/legacy bucket. New imports
    // always carry contentId so this only fires for synthetic call-sites.
    const tier1 = baseDict({ id: 'old-tier1', contentId: 'A', name: 'Webster' });
    const tier0 = baseDict({ id: 'old-tier0', contentId: undefined, name: 'Webster' });
    const incoming = baseDict({ id: 'new', contentId: undefined, name: 'Webster' });
    expect(findExistingDictionaryMatches(incoming, [tier1, tier0])).toEqual([tier0]);
  });

  test('no matches when nothing aligns', () => {
    const existing = baseDict({ id: 'old', contentId: 'A', name: 'Foo' });
    const incoming = baseDict({ id: 'new', contentId: 'B', name: 'Bar' });
    expect(findExistingDictionaryMatches(incoming, [existing])).toEqual([]);
  });
});

describe('preserveUserCustomName', () => {
  test("returns the new dict with the existing entry's name", () => {
    const existing = baseDict({ id: 'old', name: 'My Renamed Dict' });
    const incoming = baseDict({ id: 'new', name: 'Webster Original' });
    expect(preserveUserCustomName(incoming, [existing]).name).toBe('My Renamed Dict');
  });

  test("uses the FIRST matched entry's name when multiple exist", () => {
    const a = baseDict({ id: 'old-1', name: "Alice's label" });
    const b = baseDict({ id: 'old-2', name: "Bob's label" });
    const incoming = baseDict({ id: 'new', name: 'Original' });
    expect(preserveUserCustomName(incoming, [a, b]).name).toBe("Alice's label");
  });

  test('returns the new dict unchanged when matches array is empty', () => {
    const incoming = baseDict({ id: 'new', name: 'Original' });
    expect(preserveUserCustomName(incoming, []).name).toBe('Original');
  });

  test('returns a new object (does not mutate the incoming dict)', () => {
    const existing = baseDict({ name: 'Renamed' });
    const incoming = baseDict({ name: 'Original' });
    const result = preserveUserCustomName(incoming, [existing]);
    expect(result).not.toBe(incoming);
    expect(incoming.name).toBe('Original');
  });
});

describe('findTombstonedDictionaryMatches', () => {
  test('matches soft-deleted entries with the same contentId', () => {
    const tombstoned = baseDict({
      id: 'old',
      contentId: 'content-hash-A',
      deletedAt: 1700000000000,
    });
    const incoming = baseDict({ id: 'new', contentId: 'content-hash-A' });
    expect(findTombstonedDictionaryMatches(incoming, [tombstoned])).toEqual([tombstoned]);
  });

  test('does NOT match live entries (those go through the live-replacement path)', () => {
    const live = baseDict({ id: 'old', contentId: 'A', deletedAt: undefined });
    const incoming = baseDict({ id: 'new', contentId: 'A' });
    expect(findTombstonedDictionaryMatches(incoming, [live])).toEqual([]);
  });

  test('does NOT match when contentIds differ', () => {
    const tombstoned = baseDict({ id: 'old', contentId: 'A', deletedAt: 1 });
    const incoming = baseDict({ id: 'new', contentId: 'B' });
    expect(findTombstonedDictionaryMatches(incoming, [tombstoned])).toEqual([]);
  });

  test('returns [] when incoming has no contentId (legacy bundles cannot reincarnate)', () => {
    const tombstoned = baseDict({ id: 'old', contentId: 'A', deletedAt: 1 });
    const incoming = baseDict({ id: 'new', contentId: undefined });
    expect(findTombstonedDictionaryMatches(incoming, [tombstoned])).toEqual([]);
  });

  test('returns all tombstoned entries with the same contentId (multi-history)', () => {
    const a = baseDict({ id: 'old-1', contentId: 'A', deletedAt: 1 });
    const b = baseDict({ id: 'old-2', contentId: 'A', deletedAt: 2 });
    const incoming = baseDict({ id: 'new', contentId: 'A' });
    expect(findTombstonedDictionaryMatches(incoming, [a, b])).toEqual([a, b]);
  });

  test('does NOT match tombstoned entries that lack contentId (legacy)', () => {
    const tombstoned = baseDict({ id: 'old', contentId: undefined, deletedAt: 1 });
    const incoming = baseDict({ id: 'new', contentId: 'A' });
    expect(findTombstonedDictionaryMatches(incoming, [tombstoned])).toEqual([]);
  });
});

describe('preserveLiveDictionaryState', () => {
  test('carries the existing entry name, addedAt, and reincarnation token onto incoming', () => {
    const existing = baseDict({
      id: 'old',
      name: 'User Label',
      addedAt: 123,
      reincarnation: 'epoch-1',
    });
    const incoming = baseDict({
      id: 'new',
      name: 'Parsed Label',
      addedAt: 456,
      reincarnation: undefined,
    });
    const result = preserveLiveDictionaryState(incoming, [existing]);
    expect(result.name).toBe('User Label');
    expect(result.addedAt).toBe(123);
    expect(result.reincarnation).toBe('epoch-1');
  });

  test('keeps file-backed fields from the incoming bundle', () => {
    const existing = baseDict({
      id: 'old',
      contentId: 'old-content',
      bundleDir: 'old-dir',
      files: { mdx: 'old.mdx' },
      lang: 'en',
      unsupported: true,
      unsupportedReason: 'old parser failure',
      unavailable: true,
    });
    const incoming = baseDict({
      id: 'new',
      contentId: 'new-content',
      bundleDir: 'new-dir',
      files: { mdx: 'new.mdx' },
      lang: 'gbk',
      unsupported: undefined,
      unsupportedReason: undefined,
      unavailable: undefined,
    });
    const result = preserveLiveDictionaryState(incoming, [existing]);
    expect(result.id).toBe('new');
    expect(result.contentId).toBe('new-content');
    expect(result.bundleDir).toBe('new-dir');
    expect(result.files).toEqual({ mdx: 'new.mdx' });
    expect(result.lang).toBe('gbk');
    expect(result.unsupported).toBeUndefined();
    expect(result.unsupportedReason).toBeUndefined();
    expect(result.unavailable).toBeUndefined();
  });

  test("uses the FIRST matched entry's live state when multiple exist", () => {
    const a = baseDict({ id: 'old-1', name: 'A', addedAt: 1, reincarnation: 'epoch-A' });
    const b = baseDict({ id: 'old-2', name: 'B', addedAt: 2, reincarnation: 'epoch-B' });
    const incoming = baseDict({ id: 'new', name: 'Parsed', addedAt: 3 });
    const result = preserveLiveDictionaryState(incoming, [a, b]);
    expect(result.name).toBe('A');
    expect(result.addedAt).toBe(1);
    expect(result.reincarnation).toBe('epoch-A');
  });

  test('no-op when matches is empty', () => {
    const incoming = baseDict({ id: 'new', name: 'Parsed', addedAt: 3 });
    expect(preserveLiveDictionaryState(incoming, [])).toEqual(incoming);
  });

  test('does NOT mutate incoming', () => {
    const existing = baseDict({ id: 'old', name: 'User Label', reincarnation: 'epoch-1' });
    const incoming = baseDict({ id: 'new', name: 'Parsed' });
    const result = preserveLiveDictionaryState(incoming, [existing]);
    expect(result).not.toBe(incoming);
    expect(incoming.name).toBe('Parsed');
    expect(incoming.reincarnation).toBeUndefined();
  });

  test('preserves an explicit incoming reincarnation when matches has none', () => {
    const existing = baseDict({ id: 'old', reincarnation: undefined });
    const incoming = baseDict({ id: 'new', reincarnation: 'fresh-mint' });
    expect(preserveLiveDictionaryState(incoming, [existing]).reincarnation).toBe('fresh-mint');
  });
});

describe('shouldMintReincarnationForLiveReimport', () => {
  test('mints when explicit live re-import matches the same content and has no token', () => {
    const existing = baseDict({ id: 'old', contentId: 'content-hash-A' });
    const incoming = baseDict({ id: 'new', contentId: 'content-hash-A' });
    expect(shouldMintReincarnationForLiveReimport(incoming, [existing])).toBe(true);
  });

  test('does not mint when the live entry already has a token to preserve', () => {
    const existing = baseDict({
      id: 'old',
      contentId: 'content-hash-A',
      reincarnation: 'epoch-1',
    });
    const incoming = baseDict({ id: 'new', contentId: 'content-hash-A' });
    expect(shouldMintReincarnationForLiveReimport(incoming, [existing])).toBe(false);
  });

  test('does not mint for legacy name-only replacements', () => {
    const existing = baseDict({ id: 'old', contentId: undefined, name: 'Webster' });
    const incoming = baseDict({ id: 'new', contentId: 'content-hash-A', name: 'Webster' });
    expect(shouldMintReincarnationForLiveReimport(incoming, [existing])).toBe(false);
  });

  test('does not mint without matches or without incoming contentId', () => {
    expect(shouldMintReincarnationForLiveReimport(baseDict(), [])).toBe(false);
    expect(
      shouldMintReincarnationForLiveReimport(baseDict({ contentId: undefined }), [baseDict()]),
    ).toBe(false);
  });
});
