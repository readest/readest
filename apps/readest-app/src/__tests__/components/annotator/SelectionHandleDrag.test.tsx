import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { Handle } from '@/app/reader/components/annotator/AnnotationRangeEditor';

/**
 * A handle is grabbed by its bulb, which hangs ~20px off the text line, while
 * `position` is the line edge the stem points at. Dragging must move that edge
 * by the pointer's delta: reporting the raw pointer made the first move jump
 * the handle (and the caret hit-test) onto the neighbouring line.
 */
describe('selection handle drag', () => {
  afterEach(cleanup);

  it('reports the stem point, not the raw pointer, while dragging', () => {
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.releasePointerCapture = vi.fn();
    const onDrag = vi.fn();
    const { getByTestId } = render(
      <Handle
        position={{ x: 100, y: 200 }}
        isVertical={false}
        type='end'
        color='#000'
        onDragStart={() => {}}
        onDrag={onDrag}
        onDragEnd={() => {}}
      />,
    );
    const handle = getByTestId('selection-handle');

    // Grab the bulb 20px below the line edge, then move down by 30px.
    fireEvent.pointerDown(handle, { clientX: 104, clientY: 220, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 104, clientY: 220, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 114, clientY: 250, pointerId: 1 });

    expect(onDrag).toHaveBeenNthCalledWith(1, { x: 100, y: 200 });
    expect(onDrag).toHaveBeenNthCalledWith(2, { x: 110, y: 230 });
  });
});
