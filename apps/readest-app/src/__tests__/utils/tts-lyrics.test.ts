import { describe, expect, it } from 'vitest';

import { lyricIndexAtCenter, lyricScrollTopFor, normalizeLyricText } from '@/utils/ttsLyrics';

describe('normalizeLyricText', () => {
  it('collapses the source document whitespace into one line', () => {
    expect(normalizeLyricText('  From the dining\n   room  on my left\t there ')).toBe(
      'From the dining room on my left there',
    );
  });

  it('returns an empty string for whitespace-only ranges', () => {
    expect(normalizeLyricText(' \n\t ')).toBe('');
  });
});

describe('lyricIndexAtCenter', () => {
  // Four lines, 40px tall, laid out after a 100px half-viewport spacer.
  const centers = [120, 160, 200, 240];

  it('reports -1 for an empty list', () => {
    expect(lyricIndexAtCenter([], 100)).toBe(-1);
  });

  it('snaps to the nearest line centre', () => {
    expect(lyricIndexAtCenter(centers, 120)).toBe(0);
    expect(lyricIndexAtCenter(centers, 138)).toBe(0);
    expect(lyricIndexAtCenter(centers, 142)).toBe(1);
    expect(lyricIndexAtCenter(centers, 200)).toBe(2);
  });

  it('breaks an exact tie towards the earlier line', () => {
    expect(lyricIndexAtCenter(centers, 140)).toBe(0);
  });

  it('clamps past either end', () => {
    expect(lyricIndexAtCenter(centers, -50)).toBe(0);
    expect(lyricIndexAtCenter(centers, 9999)).toBe(3);
  });

  it('handles a single line', () => {
    expect(lyricIndexAtCenter([120], 0)).toBe(0);
    expect(lyricIndexAtCenter([120], 9999)).toBe(0);
  });
});

describe('lyricScrollTopFor', () => {
  const centers = [120, 160, 200, 240];
  const heights = [40, 40, 40, 40];

  it('centres the requested line in the viewport', () => {
    expect(lyricScrollTopFor(centers, heights, 2, 200)).toBe(100);
  });

  it('round-trips with lyricIndexAtCenter', () => {
    for (let i = 0; i < centers.length; i++) {
      const top = lyricScrollTopFor(centers, heights, i, 200);
      expect(lyricIndexAtCenter(centers, top + 100)).toBe(i);
    }
  });

  it('parks a sentence taller than the window at its first row', () => {
    // A 300px sentence centred in a 200px window would hide its opening words.
    const tall = [40, 300, 40, 40];
    const tallCenters = [120, 290, 460, 500];
    expect(lyricScrollTopFor(tallCenters, tall, 1, 200)).toBe(140);
  });

  it('never scrolls above the top of the content', () => {
    expect(lyricScrollTopFor(centers, heights, 0, 400)).toBe(0);
  });

  it('returns 0 for an index the list does not have', () => {
    expect(lyricScrollTopFor(centers, heights, 9, 200)).toBe(0);
    expect(lyricScrollTopFor([], [], 0, 200)).toBe(0);
  });
});
