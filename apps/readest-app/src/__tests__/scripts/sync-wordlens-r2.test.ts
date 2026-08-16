import { describe, it, expect } from 'vitest';
import { planSync, manifestChanged } from '../../../scripts/sync-wordlens-r2.mjs';

// The sync script mirrors data/wordlens to R2. Re-uploading all ~20 MB when a single
// pair changed is wasted bandwidth, so planSync diffs the local manifest against the
// one already published on the CDN (which carries each pack's sha256) and returns only
// the packs that are new or changed.

const pack = (pair: string, sha: string) => ({
  pair,
  source: pair.split('-')[0]!,
  target: pair.split('-')[1]!,
  file: `${pair}.json`,
  bytes: 100,
  sha256: sha,
  entries: 10,
});

const local = {
  schemaVersion: 1,
  packs: [pack('en-zh', 'aaa'), pack('en-es', 'bbb'), pack('en-vi', 'ccc')],
};

describe('planSync', () => {
  it('uploads only the pack whose sha256 changed', () => {
    const remote = {
      schemaVersion: 1,
      packs: [pack('en-zh', 'aaa'), pack('en-es', 'bbb'), pack('en-vi', 'OLD')],
    };
    expect(planSync(local, remote)).toEqual(['en-vi.json']);
  });

  it('uploads a pack the CDN has never seen', () => {
    const remote = { schemaVersion: 1, packs: [pack('en-zh', 'aaa'), pack('en-es', 'bbb')] };
    expect(planSync(local, remote)).toEqual(['en-vi.json']);
  });

  it('uploads nothing when every pack already matches', () => {
    expect(planSync(local, local)).toEqual([]);
  });

  it('uploads everything when the remote manifest is unreachable', () => {
    expect(planSync(local, null)).toEqual(['en-es.json', 'en-vi.json', 'en-zh.json']);
  });

  it('uploads everything when forced, even if the shas match', () => {
    expect(planSync(local, local, { force: true })).toEqual([
      'en-es.json',
      'en-vi.json',
      'en-zh.json',
    ]);
  });

  it('ignores a remote pack that no longer exists locally', () => {
    const remote = { schemaVersion: 1, packs: [...local.packs, pack('it-en', 'ddd')] };
    expect(planSync(local, remote)).toEqual([]);
  });
});

// planSync alone can't decide whether to publish the manifest: dropping a pair changes
// the manifest while leaving every remaining pack byte-identical, so a "no packs to
// upload" run must still republish, or the CDN keeps advertising the retired pack.
describe('manifestChanged', () => {
  it('is false when the CDN manifest already matches', () => {
    expect(manifestChanged(local, local)).toBe(false);
  });

  it('is true when a pack was retired locally (no pack upload would be planned)', () => {
    const remote = { schemaVersion: 1, packs: [...local.packs, pack('it-en', 'ddd')] };
    expect(planSync(local, remote)).toEqual([]); // nothing to upload...
    expect(manifestChanged(local, remote)).toBe(true); // ...but the manifest is stale
  });

  it('is true when a pack sha changed', () => {
    const remote = {
      schemaVersion: 1,
      packs: [pack('en-zh', 'aaa'), pack('en-es', 'bbb'), pack('en-vi', 'OLD')],
    };
    expect(manifestChanged(local, remote)).toBe(true);
  });

  it('is true when the schema version changed', () => {
    expect(manifestChanged(local, { ...local, schemaVersion: 2 })).toBe(true);
  });

  it('is true when the remote manifest is unreachable', () => {
    expect(manifestChanged(local, null)).toBe(true);
  });

  // resolvePack routes on source/target, so they belong in the key even though the
  // generator cannot currently diverge them from the hash: packEntry reads both out of
  // the pack's meta, which sha256 covers. Keeps the key honest if that ever changes.
  it('is true when a pack is rerouted to another language, hash unchanged', () => {
    const rerouted = { ...pack('en-vi', 'ccc'), target: 'vt' };
    const remote = {
      schemaVersion: 1,
      packs: [pack('en-zh', 'aaa'), pack('en-es', 'bbb'), rerouted],
    };
    expect(planSync(local, remote)).toEqual([]); // file + sha256 both match
    expect(manifestChanged(local, remote)).toBe(true);
  });

  it('ignores pack ordering and derived fields the client never diffs on', () => {
    const remote = {
      schemaVersion: 1,
      packs: [{ ...pack('en-vi', 'ccc'), bytes: 999 }, pack('en-zh', 'aaa'), pack('en-es', 'bbb')],
    };
    expect(manifestChanged(local, remote)).toBe(false);
  });
});
