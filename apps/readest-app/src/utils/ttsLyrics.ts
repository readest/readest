// Geometry and text helpers for the lyric-style sentence view in the Read
// Aloud player (see TTSLyricsView). Kept pure so the scroll math is unit
// tested without a layout engine — jsdom reports every offset as 0.

// One timeline sentence rendered as one lyric line. Range text carries the
// source document's line breaks and indentation; a lyric line is a single
// run of words.
export const normalizeLyricText = (text: string): string => text.replace(/\s+/g, ' ').trim();

// Index of the line whose vertical centre sits closest to `center` (a
// content-space offset, i.e. scrollTop + viewportHeight / 2). Centres are
// ascending, so this is a binary search plus a neighbour comparison.
// Returns -1 only for an empty list.
export const lyricIndexAtCenter = (centers: number[], center: number): number => {
  const n = centers.length;
  if (n === 0) return -1;
  let low = 0;
  let high = n - 1;
  // Last line whose centre is at or before the target.
  let index = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (centers[mid]! <= center) {
      index = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  if (index < 0) return 0;
  if (index >= n - 1) return n - 1;
  const before = center - centers[index]!;
  const after = centers[index + 1]! - center;
  return after < before ? index + 1 : index;
};

// scrollTop that parks line `index` in the middle of the viewport. The view
// pads its content with half-viewport spacers, so this never needs clamping
// at the far end; the near end is clamped for safety only.
//
// A book sentence is not a song lyric: the long ones wrap past the height of
// the window. Centring those would show their middle and hide the words the
// voice is about to say, so a line taller than the viewport parks its first
// row at the top and reads downwards instead.
export const lyricScrollTopFor = (
  centers: number[],
  heights: number[],
  index: number,
  viewportHeight: number,
): number => {
  const center = centers[index];
  if (center === undefined) return 0;
  const height = heights[index] ?? 0;
  const top = height > viewportHeight ? center - height / 2 : center - viewportHeight / 2;
  return Math.max(top, 0);
};
