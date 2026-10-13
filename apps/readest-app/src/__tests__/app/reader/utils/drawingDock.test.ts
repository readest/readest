import { describe, it, expect } from 'vitest';

import { getDrawingDockClearance } from '@/app/reader/utils/drawingDock';

describe('getDrawingDockClearance', () => {
  it('keeps the text clear of the drawing dock, inside the safe area', () => {
    const insets = { top: 24, right: 0, bottom: 16, left: 0 };
    // The h-13 dock with an 8px gap to the text; nothing covers the top.
    expect(getDrawingDockClearance(insets)).toEqual({ bottom: 16 + 52 + 8 });
  });
});
