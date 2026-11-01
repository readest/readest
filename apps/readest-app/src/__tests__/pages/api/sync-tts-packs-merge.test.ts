import { describe, expect, it } from 'vitest';
import { resolveTTSPacksMerge } from '@/pages/api/sync';

describe('resolveTTSPacksMerge', () => {
  it('unions both rows, whichever wins on updated_at', () => {
    // Recording audio never bumps updated_at, so an older row can carry packs
    // the newer one lacks.
    expect(
      resolveTTSPacksMerge(
        { tts_packs: JSON.stringify({ webdav: ['1-a.mp3'] }) },
        { tts_packs: JSON.stringify({ webdav: ['2-b.mp3'], readest: [] }) },
      ),
    ).toEqual({
      value: JSON.stringify({ webdav: ['2-b.mp3', '1-a.mp3'], readest: [] }),
      changed: true,
    });
  });

  it('is unchanged when the client adds nothing the server lacks', () => {
    const server = { tts_packs: JSON.stringify({ webdav: ['1-a.mp3'] }) };
    expect(resolveTTSPacksMerge({}, server)).toEqual({ value: server.tts_packs, changed: false });
    expect(resolveTTSPacksMerge({ tts_packs: server.tts_packs }, server).changed).toBe(false);
  });

  it('reads a jsonb object as well as a string', () => {
    expect(
      resolveTTSPacksMerge(
        { tts_packs: JSON.stringify({ webdav: ['2-b.mp3'] }) },
        { tts_packs: { webdav: ['1-a.mp3'] } as never },
      ).value,
    ).toBe(JSON.stringify({ webdav: ['1-a.mp3', '2-b.mp3'] }));
  });

  it('is null when neither row has packs', () => {
    expect(resolveTTSPacksMerge({}, {})).toEqual({ value: null, changed: false });
  });
});
