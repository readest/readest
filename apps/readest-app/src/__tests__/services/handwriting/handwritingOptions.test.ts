import { describe, it, expect } from 'vitest';

import {
  DEFAULT_HANDWRITING_COLOR,
  DEFAULT_HANDWRITING_WIDTH,
  HANDWRITING_COLORS,
  HANDWRITING_WIDTHS,
  HandwritingService,
} from '@/services/handwriting/handwritingService';
import { HandwritingEditor } from '@/services/handwriting/editor';

const rect = { left: 0, top: 0, width: 400, height: 800 };

const makeService = (options?: { color?: string; widthFraction?: number }) =>
  new HandwritingService(new HandwritingEditor(), 'pdf:1', rect, options);

describe('handwriting pen options', () => {
  it('defaults to the documented pen', () => {
    const service = makeService();
    const strokes = service.strokesForRender();
    expect(strokes).toEqual([]);
    expect(DEFAULT_HANDWRITING_COLOR).toBe('#1a1a1a');
    expect(DEFAULT_HANDWRITING_WIDTH).toBe(0.004);
  });

  it('exposes the default color as the first swatch, so a fresh install has a selected dot', () => {
    expect(HANDWRITING_COLORS[0]).toBe(DEFAULT_HANDWRITING_COLOR);
  });

  it('orders widths lightest to heaviest and includes the default', () => {
    const sorted = [...HANDWRITING_WIDTHS].sort((a, b) => a - b);
    expect([...HANDWRITING_WIDTHS]).toEqual(sorted);
    expect(HANDWRITING_WIDTHS).toContain(DEFAULT_HANDWRITING_WIDTH);
  });

  it('offers only colors the renderer can draw', () => {
    for (const color of HANDWRITING_COLORS) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('applies a new pen to strokes drawn after the change', () => {
    const editor = new HandwritingEditor();
    const service = new HandwritingService(editor, 'pdf:1', rect, { color: '#1f6feb' });
    const live = service.strokesForRender();
    expect(live).toEqual([]);

    service.setOptions({ color: '#c2410c', widthFraction: 0.008 });
    // setOptions repaints; committed strokes keep their original pen.
    expect(editor.toDocument().pages).toEqual({});
  });

  it('leaves already-committed strokes untouched when the pen changes', () => {
    const editor = new HandwritingEditor();
    editor.addStroke('pdf:1', {
      id: 'old',
      color: '#1a1a1a',
      width: 0.004,
      points: [[0.2, 0.2]],
    });
    const service = new HandwritingService(editor, 'pdf:1', rect);

    service.setOptions({ color: '#15803d', widthFraction: 0.014 });

    const strokes = service.strokesForRender();
    expect(strokes).toHaveLength(1);
    expect(strokes[0]?.color).toBe('#1a1a1a');
    expect(strokes[0]?.width).toBe(0.004);
  });

  it('notifies renderers so the canvas repaints on a pen change', () => {
    const service = makeService();
    let renders = 0;
    service.onNeedsRender(() => renders++);
    service.setOptions({ color: '#9333ea' });
    expect(renders).toBe(1);
  });
});
