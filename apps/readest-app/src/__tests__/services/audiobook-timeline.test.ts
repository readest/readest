import { describe, it, expect } from 'vitest';
import { AudiobookTimeline } from '@/services/audiobook/AudiobookTimeline';
import type { ABSChapter, ABSTrack } from '@/types/audiobookshelf';

const track = (index: number, startOffset: number, duration: number): ABSTrack => ({
  index,
  startOffset,
  duration,
  contentUrl: `/api/items/i/file/${index}`,
  mimeType: 'audio/mpeg',
});
const tracks = [track(1, 0, 100), track(2, 100, 50), track(3, 150, 200)];
const chapters: ABSChapter[] = [
  { id: 0, start: 0, end: 120, title: 'One' },
  { id: 1, start: 120, end: 350, title: 'Two' },
];

describe('AudiobookTimeline', () => {
  const tl = new AudiobookTimeline(tracks, chapters);

  it('sums the duration', () => {
    expect(tl.duration).toBe(350);
  });

  it('locates global positions inside the right track', () => {
    expect(tl.locate(0)).toEqual({ trackIndex: 0, offset: 0 });
    expect(tl.locate(99.5)).toEqual({ trackIndex: 0, offset: 99.5 });
    expect(tl.locate(100)).toEqual({ trackIndex: 1, offset: 0 });
    expect(tl.locate(149)).toEqual({ trackIndex: 1, offset: 49 });
    expect(tl.locate(349)).toEqual({ trackIndex: 2, offset: 199 });
  });

  it('clamps out-of-range positions', () => {
    expect(tl.locate(-5)).toEqual({ trackIndex: 0, offset: 0 });
    expect(tl.locate(9999).trackIndex).toBe(2);
  });

  it('round-trips toGlobal', () => {
    expect(tl.toGlobal(1, 25)).toBe(125);
  });

  it('finds chapters and boundaries', () => {
    expect(tl.chapterAt(0)?.title).toBe('One');
    expect(tl.chapterAt(119.9)?.title).toBe('One');
    expect(tl.chapterAt(120)?.title).toBe('Two');
    expect(tl.nextChapterStart(10)).toBe(120);
    expect(tl.nextChapterStart(200)).toBeNull();
  });

  it('prevChapterStart restarts the current chapter when > 3s in, else jumps back', () => {
    expect(tl.prevChapterStart(130)).toBe(120); // 10s into Two -> restart Two
    expect(tl.prevChapterStart(121)).toBe(0); // 1s into Two -> back to One
    expect(tl.prevChapterStart(1)).toBe(0); // start of book stays put
  });

  it('handles a chapterless book', () => {
    const bare = new AudiobookTimeline(tracks, []);
    expect(bare.chapterAt(50)).toBeNull();
    expect(bare.nextChapterStart(50)).toBeNull();
    expect(bare.prevChapterStart(50)).toBe(0);
  });

  it('clamps offset to track duration with drifted startOffsets (VBR)', () => {
    // Simulate ABS startOffset drift: gap between track 1 and 2
    // Track 1: startOffset 0, duration 100
    // Track 2: startOffset 105 (drift: 5s gap), duration 50
    // Total duration = 100 + 50 = 150
    const driftedTracks = [track(1, 0, 100), track(2, 105, 50)];
    const driftedTl = new AudiobookTimeline(driftedTracks, []);

    // Position 103 is within duration (150) but past track 1's end
    // Should locate track 0 with offset clamped to track 0's duration (100)
    const result = driftedTl.locate(103);
    expect(result.trackIndex).toBe(0);
    expect(result.offset).toBe(100); // clamped, not 103
  });
});
