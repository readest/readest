import { describe, it, expect } from 'vitest';

import { getDrawingBarsClearance } from '@/app/reader/utils/drawingBars';

describe('getDrawingBarsClearance', () => {
  it('keeps the text clear of the drawing top bar and dock, inside the safe area', () => {
    const insets = { top: 24, right: 0, bottom: 16, left: 0 };
    // h-11 top bar and h-13 dock, each with an 8px gap to the text.
    expect(getDrawingBarsClearance(insets)).toEqual({ top: 24 + 44 + 8, bottom: 16 + 52 + 8 });
  });
});
