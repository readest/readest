import { describe, expect, it } from 'vitest';

import { computeScrollWheelDelta } from 'foliate-js/fixed-layout.js';

// Horizontal scroll mode translates vertical wheel ticks into horizontal
// scrolling (pdf.js behavior, readest#4995). Translation must stand down for
// pinch zoom (ctrl), horizontal-dominant trackpad pans, vertical mode, and
// whenever the strip has vertical overflow for the tick to consume (a zoomed
// page pans vertically first).
describe('computeScrollWheelDelta', () => {
  const base = {
    deltaX: 0,
    deltaY: 120,
    ctrlKey: false,
    horizontal: true,
    rtl: false,
    verticalOverflow: false,
  };

  it('translates vertical wheel to forward horizontal scroll (LTR)', () => {
    expect(computeScrollWheelDelta(base)).toEqual({ left: 120 });
  });

  it('flips the sign for RTL books', () => {
    expect(computeScrollWheelDelta({ ...base, rtl: true })).toEqual({ left: -120 });
  });

  it('scrolls backward on wheel up', () => {
    expect(computeScrollWheelDelta({ ...base, deltaY: -120 })).toEqual({ left: -120 });
  });

  it('stands down in vertical mode', () => {
    expect(computeScrollWheelDelta({ ...base, horizontal: false })).toBeNull();
  });

  it('stands down for pinch zoom (ctrl+wheel)', () => {
    expect(computeScrollWheelDelta({ ...base, ctrlKey: true })).toBeNull();
  });

  it('stands down while the strip overflows vertically (zoomed page)', () => {
    expect(computeScrollWheelDelta({ ...base, verticalOverflow: true })).toBeNull();
  });

  it('leaves horizontal-dominant trackpad pans to native scrolling', () => {
    expect(computeScrollWheelDelta({ ...base, deltaX: 200, deltaY: 120 })).toBeNull();
  });
});
