import { describe, expect, it } from 'vitest';
import {
  MANIFEST_SCHEMA,
  SUPPORTED_SCHEMA_VERSION,
  assetContentPath,
  isSupportedManifest,
  manifestChapters,
  manifestTracks,
} from '@/services/bookorbit/manifest';
import type { BookOrbitManifest } from '@/services/bookorbit/manifest';

// Shapes captured from a live BookOrbit 2.10.0 instance (2026-09-19).
const MANIFEST: BookOrbitManifest = {
  schema: MANIFEST_SCHEMA,
  schemaVersion: 2,
  revision: 'f'.repeat(64),
  book: { id: 9, title: 'A Christmas Carol', authors: ['Charles Dickens'], narrators: [] },
  assets: [
    {
      assetId: 'aud_c7989ff0-33f3-4b34-999a-b58233b09295',
      sequence: 0,
      format: 'mp3',
      durationMs: 2680000,
      sizeBytes: 42881005,
      etag: 'a'.repeat(64),
    },
    {
      assetId: 'aud_7361a5c7-1b92-4652-8e3f-2d7fbd30cf6a',
      sequence: 1,
      format: 'mp3',
      durationMs: 2661000,
      sizeBytes: 42000000,
      etag: 'b'.repeat(64),
    },
  ],
  chapters: [
    {
      id: 'ch_572021a6ad5b509e5f482448242b6130',
      title: '19505-01',
      assetId: 'aud_c7989ff0-33f3-4b34-999a-b58233b09295',
      sequence: 0,
      startMs: 0,
      endMs: 2680000,
      assetOffsetMs: 0,
    },
    {
      id: 'ch_3c1b444a8c1630c05c4dd817a4e007ba',
      title: '19505-02',
      assetId: 'aud_7361a5c7-1b92-4652-8e3f-2d7fbd30cf6a',
      sequence: 1,
      startMs: 2680000,
      endMs: 5341000,
      assetOffsetMs: 0,
    },
  ],
};

describe('isSupportedManifest', () => {
  it('accepts the schema version we understand', () => {
    expect(isSupportedManifest(MANIFEST)).toBe(true);
  });

  // The server stamps a schema name and version precisely so a client can
  // refuse politely instead of misreading a changed payload.
  it('rejects a future schema version rather than guessing', () => {
    expect(isSupportedManifest({ ...MANIFEST, schemaVersion: SUPPORTED_SCHEMA_VERSION + 1 })).toBe(
      false,
    );
    expect(isSupportedManifest({ ...MANIFEST, schema: 'something.else' })).toBe(false);
    expect(isSupportedManifest(null)).toBe(false);
    expect(isSupportedManifest({ schema: MANIFEST_SCHEMA })).toBe(false);
  });
});

describe('manifestTracks', () => {
  it('lays assets end to end in sequence order', () => {
    const tracks = manifestTracks(MANIFEST);

    expect(tracks.map((t) => t.startOffset)).toEqual([0, 2680]);
    expect(tracks.map((t) => t.duration)).toEqual([2680, 2661]);
    expect(tracks[0]!.mimeType).toBe('audio/mpeg');
    expect(tracks[0]!.contentUrl).toBe(
      '/api/v1/audiobooks/9/assets/aud_c7989ff0-33f3-4b34-999a-b58233b09295/content',
    );
  });

  it('sorts by sequence even when the server returns them out of order', () => {
    const shuffled = { ...MANIFEST, assets: [...MANIFEST.assets].reverse() };

    expect(manifestTracks(shuffled).map((t) => t.index)).toEqual([0, 1]);
    expect(manifestTracks(shuffled).map((t) => t.startOffset)).toEqual([0, 2680]);
  });
});

describe('manifestChapters', () => {
  // This is what OPDS could never give us: real chapter boundaries rather than
  // a timeline faked from track edges.
  it('converts chapter times to the global seconds the timeline expects', () => {
    const chapters = manifestChapters(MANIFEST);

    expect(chapters).toEqual([
      { id: 0, start: 0, end: 2680, title: '19505-01' },
      { id: 1, start: 2680, end: 5341, title: '19505-02' },
    ]);
  });
});

describe('assetContentPath', () => {
  it('builds the server-relative range-capable asset path', () => {
    expect(assetContentPath(9, 'aud_x')).toBe('/api/v1/audiobooks/9/assets/aud_x/content');
  });
});
