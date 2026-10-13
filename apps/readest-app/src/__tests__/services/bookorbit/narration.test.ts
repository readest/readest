import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PairedAudiobookBookOrbitSource } from '@/types/book';

const h = vi.hoisted(() => ({ streamUrl: null as ((path: string) => string) | null }));

vi.mock('@/services/bookorbit/createClient', () => ({ createBookOrbitClient: () => ({}) }));
vi.mock('@/services/bookorbit/mediaProxy', () => ({
  openBookOrbitMediaProxy: async () => h.streamUrl,
}));

const { bookOrbitNarrationTracks } = await import('@/services/bookorbit/narration');

const source: PairedAudiobookBookOrbitSource = {
  kind: 'bookorbit',
  bookId: 8,
  tracks: [
    { index: 0, startOffset: 0, duration: 3907, contentUrl: '/api/v1/audiobooks/8/a/1/content' },
    { index: 1, startOffset: 3907, duration: 2479, contentUrl: '/api/v1/audiobooks/8/a/2/content' },
  ],
};

beforeEach(() => {
  h.streamUrl = null;
});

describe('bookOrbitNarrationTracks', () => {
  // The proxy is a real origin, so the element issues its own Range requests
  // and a chapter starting part-way into a track can be seeked to.
  it('streams through the media proxy when it is available', async () => {
    h.streamUrl = (path) => `http://127.0.0.1:9/s/media?u=${encodeURIComponent(path)}`;

    const tracks = await bookOrbitNarrationTracks(source);

    expect(tracks.map((track) => track.url)).toEqual([
      'http://127.0.0.1:9/s/media?u=%2Fapi%2Fv1%2Faudiobooks%2F8%2Fa%2F1%2Fcontent',
      'http://127.0.0.1:9/s/media?u=%2Fapi%2Fv1%2Faudiobooks%2F8%2Fa%2F2%2Fcontent',
    ]);
    expect(tracks.map((track) => track.startOffset)).toEqual([0, 3907]);
  });

  // Without it, `url` carries the server path instead, which the blob loader
  // is handed back: swapping the field silently narrates nothing.
  it('falls back to the asset path, keeping the timeline intact', async () => {
    const tracks = await bookOrbitNarrationTracks(source);

    expect(tracks).toEqual([
      { url: '/api/v1/audiobooks/8/a/1/content', startOffset: 0, duration: 3907 },
      { url: '/api/v1/audiobooks/8/a/2/content', startOffset: 3907, duration: 2479 },
    ]);
  });
});
