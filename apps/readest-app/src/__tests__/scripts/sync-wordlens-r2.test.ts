import { describe, it, expect } from 'vitest';
import { planSync } from '../../../scripts/sync-wordlens-r2.mjs';

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
