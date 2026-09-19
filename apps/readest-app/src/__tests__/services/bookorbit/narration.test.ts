import { describe, expect, it } from 'vitest';
import { bookOrbitNarrationTracks } from '@/services/bookorbit/narration';
import type { PairedAudiobookBookOrbitSource } from '@/types/book';

const source: PairedAudiobookBookOrbitSource = {
  kind: 'bookorbit',
  bookId: 8,
  tracks: [
    { index: 0, startOffset: 0, duration: 3907, contentUrl: '/api/v1/audiobooks/8/a/1/content' },
    { index: 1, startOffset: 3907, duration: 2479, contentUrl: '/api/v1/audiobooks/8/a/2/content' },
  ],
};

describe('bookOrbitNarrationTracks', () => {
  // `url` carries the server path, not a URL: the blob loader is handed this
  // value back, so swapping the field silently narrates nothing.
  it('lays the pairing out on the narration timeline, keyed by content path', () => {
    expect(bookOrbitNarrationTracks(source)).toEqual([
      { url: '/api/v1/audiobooks/8/a/1/content', startOffset: 0, duration: 3907 },
      { url: '/api/v1/audiobooks/8/a/2/content', startOffset: 3907, duration: 2479 },
    ]);
  });
});
