// Following the reading position across a page break *inside* one sentence.
//
// Sentence marks fire when a sentence starts, and that is when the view
// navigates to it. A sentence whose tail is laid out on the next page therefore
// leaves the reader stranded: the voice reads on while the visible page still
// shows only the part already spoken. Engines that report word boundaries paper
// over this by following each word, but a recorded narration is timed per
// phrase, so between one mark and the next there is nothing to follow.
//
// What there is, for an engine with a media clock, is how far through the
// sentence's audio we are. To compare that against the page we need to know
// where the page stops showing the sentence — and that is a property of the
// layout, not of the text: the same sentence breaks at a different word on a
// phone, at a larger font size, or in a narrower column. So the break is found
// by measuring the live layout, and then expressed as a fraction of the
// sentence's *text*, which is the unit that tracks how long the narrator spends
// on it. Nothing is assumed about line width, column count or glyph size.

// Fraction of a sentence's text that is readable on the current page, i.e. how
// far through the sentence the reading position is when it leaves the page.
// `isBeyondPage` measures one character against the page edge; it flips exactly
// once, because pagination lays characters out in reading order, and that is
// what makes bisection valid. Returns null when the sentence does not leave the
// page at all, meaning there is nothing to follow.
//
// Bisection matters beyond tidiness: every probe measures the live layout and so
// forces a reflow, which a per-character scan would do thousands of times.
export const pageBreakFraction = (
  length: number,
  isBeyondPage: (offset: number) => boolean,
): number | null => {
  if (length <= 0) return null;
  if (!isBeyondPage(length - 1)) return null;

  let low = 0;
  let high = length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (isBeyondPage(mid)) high = mid;
    else low = mid + 1;
  }
  return low / length;
};
