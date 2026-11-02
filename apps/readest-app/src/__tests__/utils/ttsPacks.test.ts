import { describe, expect, test } from 'vitest';

import { mergeTTSPacks } from '@/utils/ttsPacks';

describe('mergeTTSPacks', () => {
  test('unions each destination’s packs, so no device’s additions are lost', () => {
    expect(
      mergeTTSPacks(
        { webdav: ['1-a.mp3'], readest: ['1-a.mp3'] },
        { webdav: ['2-b.mp3', '1-a.mp3'] },
      ),
    ).toEqual({ webdav: ['1-a.mp3', '2-b.mp3'], readest: ['1-a.mp3'] });
  });

  test('keeps a destination recorded as holding nothing', () => {
    // An empty list means "listed, no audio": the next open need not list it.
    expect(mergeTTSPacks({ readest: [] }, undefined)).toEqual({ readest: [] });
  });

  test('is undefined when neither side recorded anything', () => {
    expect(mergeTTSPacks(undefined, undefined)).toBeUndefined();
  });

  test('ignores malformed values from an old or broken peer', () => {
    expect(
      mergeTTSPacks({ webdav: ['1-a.mp3'] }, { webdav: 'x', s3: [3, '2-b.mp3'] } as never),
    ).toEqual({ webdav: ['1-a.mp3'], s3: ['2-b.mp3'] });
  });
});
