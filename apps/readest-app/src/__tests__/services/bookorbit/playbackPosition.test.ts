import { describe, expect, it } from 'vitest';
import { globalFromAssetPosition, assetPositionFromGlobal } from '@/services/bookorbit/manifest';
import type { ABSTrack } from '@/types/audiobookshelf';

// BookOrbit stores a position as (assetId, positionMs) *within that asset*,
// not as an offset into the whole book. Treating it as global put a resume
// point in chapter 1 no matter how far in the listener actually was.
const tracks: ABSTrack[] = [
  { index: 0, startOffset: 0, duration: 100, contentUrl: '/a/0', mimeType: 'audio/mpeg' },
  { index: 1, startOffset: 100, duration: 200, contentUrl: '/a/1', mimeType: 'audio/mpeg' },
  { index: 2, startOffset: 300, duration: 50, contentUrl: '/a/2', mimeType: 'audio/mpeg' },
];
const assetIds = ['aud_0', 'aud_1', 'aud_2'];

describe('globalFromAssetPosition', () => {
  it('adds the asset start offset to an in-asset position', () => {
    expect(globalFromAssetPosition(tracks, assetIds, 'aud_1', 30_000)).toBe(130);
    expect(globalFromAssetPosition(tracks, assetIds, 'aud_0', 5_000)).toBe(5);
    expect(globalFromAssetPosition(tracks, assetIds, 'aud_2', 10_000)).toBe(310);
  });

  it('is null for an asset the manifest no longer lists', () => {
    expect(globalFromAssetPosition(tracks, assetIds, 'aud_gone', 1_000)).toBeNull();
  });
});

describe('assetPositionFromGlobal', () => {
  it('finds the asset a global position falls in, and the offset inside it', () => {
    expect(assetPositionFromGlobal(tracks, assetIds, 130)).toEqual({
      assetId: 'aud_1',
      positionMs: 30_000,
    });
    expect(assetPositionFromGlobal(tracks, assetIds, 0)).toEqual({
      assetId: 'aud_0',
      positionMs: 0,
    });
    // Exactly on a boundary belongs to the track that starts there.
    expect(assetPositionFromGlobal(tracks, assetIds, 100)).toEqual({
      assetId: 'aud_1',
      positionMs: 0,
    });
  });

  it('clamps past the end onto the last asset rather than inventing one', () => {
    expect(assetPositionFromGlobal(tracks, assetIds, 9999)).toEqual({
      assetId: 'aud_2',
      positionMs: 50_000,
    });
  });

  it('round-trips a position back to where it started', () => {
    const at = assetPositionFromGlobal(tracks, assetIds, 275)!;
    expect(globalFromAssetPosition(tracks, assetIds, at.assetId, at.positionMs)).toBe(275);
  });
});
