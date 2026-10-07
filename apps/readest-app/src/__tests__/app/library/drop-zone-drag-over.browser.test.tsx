import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

await import('@/styles/globals.css');
afterEach(cleanup);

describe('library drop zone', () => {
  it('keeps its content width while a file is dragged over it', () => {
    // The bookshelf picks its column count from this width (8 columns from
    // 1280px), so a frame that eats layout space drops a 1280px shelf to 6
    // columns for the duration of the drag.
    const { rerender } = render(
      <div style={{ width: 1280 }}>
        <div data-testid='zone' className='drop-zone flex flex-col' />
      </div>,
    );
    const zone = screen.getByTestId('zone');
    const width = zone.clientWidth;

    rerender(
      <div style={{ width: 1280 }}>
        <div data-testid='zone' className='drop-zone drag-over flex flex-col' />
      </div>,
    );

    expect(getComputedStyle(zone).outlineStyle).toBe('dashed');
    expect(zone.clientWidth).toBe(width);
  });
});
