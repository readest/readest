import { describe, it, expect, vi } from 'vitest';

import { HandwritingEditor } from '@/services/handwriting/editor';
import { HandwritingService } from '@/services/handwriting/handwritingService';
import type { InkPoint, InkStroke } from '@/services/handwriting/model';

const rect = { left: 0, top: 0, width: 400, height: 800 };

describe('HandwritingService page scoping', () => {
  it('scopes strokes to the page it was constructed with', () => {
    const service = new HandwritingService(new HandwritingEditor(), 'pdf:1', rect);
    expect(service.strokesForRender()).toEqual([]);
  });

  it('writes strokes to the page set by setPage, not the construction page', () => {
    const editor = new HandwritingEditor();
    const service = new HandwritingService(editor, 'pdf:1', rect);

    service.setPage('pdf:2');
    service.undo();
    service.clear();
    service.redo();

    expect(editor.strokes('pdf:1')).toEqual([]);
    expect(editor.strokes('pdf:2')).toEqual([]);
  });

  it('retargets rendering at the new page on a page change', () => {
    const editor = new HandwritingEditor();
    editor.addStroke('pdf:1', { id: 'a', color: '#000', width: 0.004, points: [[0.1, 0.1]] });
    editor.addStroke('pdf:2', { id: 'b', color: '#000', width: 0.004, points: [[0.5, 0.5]] });

    const service = new HandwritingService(editor, 'pdf:1', rect);
    expect(service.strokesForRender().map((s) => s.id)).toEqual(['a']);

    service.setPage('pdf:2');
    expect(service.strokesForRender().map((s) => s.id)).toEqual(['b']);
  });

  it('notifies listeners on a page change so the canvas repaints', () => {
    const service = new HandwritingService(new HandwritingEditor(), 'pdf:1', rect);
    let renders = 0;
    service.onNeedsRender(() => renders++);

    service.setPage('pdf:2');
    expect(renders).toBe(1);

    // Same page again is a no-op: no repaint, no retarget.
    service.setPage('pdf:2');
    expect(renders).toBe(1);
  });

  it('drops an in-progress stroke when the page changes mid-stroke', () => {
    const editor = new HandwritingEditor();
    const service = new HandwritingService(editor, 'pdf:1', rect);

    // A live stroke is only rendered, never committed, so simulate the
    // dangling live state via a render before the page turn.
    service.setPage('pdf:2');
    expect(service.strokesForRender()).toEqual([]);
    expect(editor.pageKeys()).toEqual([]);
  });

  it('hit-tests a screen point against the ink on the page', () => {
    const editor = new HandwritingEditor();
    editor.addStroke('a', {
      id: 'a1',
      color: '#000',
      width: 0.004,
      points: [
        [0.1, 0.5],
        [0.9, 0.5],
      ],
    });
    const service = new HandwritingService(editor, 'a', rect);
    // rect is 400x800 at the origin: y 0.5 of the page is 400px.
    expect(service.hitTest(200, 405)).toBe(true);
    expect(service.hitTest(200, 600)).toBe(false);
    // Outside the page never hits.
    expect(service.hitTest(-50, 400)).toBe(false);
  });
});

describe('HandwritingService text anchoring', () => {
  const ANCHOR = 'epubcfi(/6/4!/4/2/1,/0,/1)';
  // A fake layout: the anchor's box sits at (0.1, 0.2) of the page, 0.05 tall.
  const fakeAnchoring = (box = { left: 0.1, top: 0.2, height: 0.05 }) => ({
    pin: vi.fn((points: InkPoint[], reuse?: string) => ({
      anchor: reuse ?? ANCHOR,
      points: points.map(
        ([x, y]): InkPoint => [(x - box.left) / box.height, (y - box.top) / box.height],
      ),
    })),
    place: (stroke: InkStroke) => [
      stroke.points.map(
        ([x, y]): InkPoint => [box.left + x * box.height, box.top + y * box.height],
      ),
    ],
  });

  const draw = (service: HandwritingService, points: InkPoint[]) =>
    (service as unknown as { onBatch: (p: InkPoint[], k: string, e: boolean) => void }).onBatch(
      points,
      'end',
      false,
    );

  it('pins a finished stroke to the text under it', () => {
    const editor = new HandwritingEditor();
    const service = new HandwritingService(editor, 'sec:1', rect);
    service.setAnchoring(fakeAnchoring());
    draw(service, [
      [0.1, 0.25],
      [0.2, 0.25],
    ]);
    const [stroke] = editor.strokes('sec:1');
    expect(stroke!.anchor).toBe(ANCHOR);
    expect(stroke!.points[0]![0]).toBeCloseTo(0);
    expect(stroke!.points[0]![1]).toBeCloseTo(1);
  });

  it('renders pinned ink where its text is now', () => {
    const editor = new HandwritingEditor();
    const service = new HandwritingService(editor, 'sec:1', rect);
    service.setAnchoring(fakeAnchoring());
    draw(service, [
      [0.1, 0.25],
      [0.2, 0.25],
    ]);
    // A larger font moved the anchor and doubled its height.
    service.setAnchoring(fakeAnchoring({ left: 0.3, top: 0.6, height: 0.1 }));
    const [placed] = service.strokesForRender();
    expect(placed!.points[0]![0]).toBeCloseTo(0.3);
    expect(placed!.points[0]![1]).toBeCloseTo(0.7);
    expect(placed!.points[1]![0]).toBeCloseTo(0.5);
  });

  it('hides pinned ink whose text is not laid out', () => {
    const editor = new HandwritingEditor();
    const service = new HandwritingService(editor, 'sec:1', rect);
    service.setAnchoring({ ...fakeAnchoring(), place: () => null });
    draw(service, [[0.1, 0.25]]);
    expect(service.strokesForRender()).toEqual([]);
    expect(service.hasInk()).toBe(false);
  });

  it('keeps a handwritten word together by sharing the previous stroke anchor', () => {
    const editor = new HandwritingEditor();
    const service = new HandwritingService(editor, 'sec:1', rect);
    const anchoring = fakeAnchoring();
    service.setAnchoring(anchoring);
    draw(service, [
      [0.5, 0.5],
      [0.52, 0.5],
    ]);
    draw(service, [
      [0.53, 0.5],
      [0.55, 0.51],
    ]);
    expect(anchoring.pin.mock.calls[1]![1]).toBe(ANCHOR);
    // A stroke far away starts its own anchor.
    draw(service, [[0.1, 0.9]]);
    expect(anchoring.pin.mock.calls[2]![1]).toBeUndefined();
  });

  it('stamps new strokes with the current drawing session', () => {
    const editor = new HandwritingEditor();
    const service = new HandwritingService(editor, 'page:1', rect);
    service.setSession('ink-a');
    draw(service, [
      [0.1, 0.1],
      [0.2, 0.2],
    ]);
    service.setSession('ink-b');
    draw(service, [
      [0.5, 0.5],
      [0.6, 0.6],
    ]);
    expect(editor.strokes('page:1').map((s) => s.session)).toEqual(['ink-a', 'ink-b']);
  });

  it('routes a stroke in a scrolled view to the page it is drawn over', () => {
    // Two PDF pages stacked in a scroll: the second starts 800px down.
    const editor = new HandwritingEditor();
    const service = new HandwritingService(editor, 'page:1', rect);
    const second = { left: 0, top: 800, width: 400, height: 800 };
    service.setRouter((points) =>
      points[0]![1] >= 800 ? { page: 'page:2', rect: second, anchoring: null } : null,
    );
    // Drawn at 1000px down in the 400x800 view's coordinates (y 1.25).
    draw(service, [
      [0.25, 1.25],
      [0.5, 1.25],
    ]);
    expect(editor.strokes('page:1')).toEqual([]);
    const [stroke] = editor.strokes('page:2');
    expect(stroke!.points[0]![0]).toBeCloseTo(0.25);
    expect(stroke!.points[0]![1]).toBeCloseTo(0.25);
    // Undo follows the page last drawn on.
    service.undo();
    expect(editor.strokes('page:2')).toEqual([]);
  });

  it('pins a routed stroke with that section anchoring', () => {
    const editor = new HandwritingEditor();
    const service = new HandwritingService(editor, 'sec:1', rect);
    service.setRouter(() => ({ page: 'sec:2', rect, anchoring: fakeAnchoring() }));
    draw(service, [
      [0.1, 0.25],
      [0.2, 0.25],
    ]);
    expect(editor.strokes('sec:2')[0]!.anchor).toBe(ANCHOR);
  });

  it('shows the live stroke on its own while scrolled pages render their ink', () => {
    const service = new HandwritingService(new HandwritingEditor(), 'sec:1', rect);
    (service as unknown as { onBatch: (p: InkPoint[], k: string, e: boolean) => void }).onBatch(
      [[0.1, 0.1]],
      'move',
      false,
    );
    expect(service.liveStrokes()).toHaveLength(1);
  });
});

describe('HandwritingService marker', () => {
  const draw = (service: HandwritingService) =>
    (service as unknown as { onBatch: (p: InkPoint[], k: string, e: boolean) => void }).onBatch(
      [
        [0.1, 0.5],
        [0.4, 0.5],
      ],
      'end',
      false,
    );

  it('records marker strokes as marker ink and pen strokes as plain ink', () => {
    const editor = new HandwritingEditor();
    const service = new HandwritingService(editor, 'pdf:1', rect);
    draw(service);
    service.setOptions({ tool: 'marker', color: '#facc15', widthFraction: 0.03 });
    draw(service);
    const [pen, marker] = editor.strokes('pdf:1');
    expect(pen).not.toHaveProperty('tool');
    expect(marker).toMatchObject({ tool: 'marker', color: '#facc15', width: 0.03 });
  });

  it('sizes the eraser to a marker stroke, not three of them', () => {
    const service = new HandwritingService(new HandwritingEditor(), 'pdf:1', rect);
    service.setOptions({ tool: 'marker', widthFraction: 0.03 });
    expect(
      (service as unknown as { options: { eraseRadiusFraction: number } }).options
        .eraseRadiusFraction,
    ).toBeCloseTo(0.03);
  });
});

describe('HandwritingService sessions', () => {
  const draw = (service: HandwritingService) =>
    (service as unknown as { onBatch: (p: InkPoint[], k: string, e: boolean) => void }).onBatch(
      [
        [0.1, 0.5],
        [0.4, 0.5],
      ],
      'end',
      false,
    );

  it('ends a drawing on save, so the next strokes start another annotation', () => {
    const editor = new HandwritingEditor();
    const service = new HandwritingService(editor, 'pdf:1', rect);
    service.setSession('ink-a');
    draw(service);
    expect(service.endSession()).toBe(true);
    draw(service);
    const [first, second] = editor.strokes('pdf:1');
    expect(first!.session).toBe('ink-a');
    expect(second!.session).toBeTruthy();
    expect(second!.session).not.toBe('ink-a');
  });

  it('reports nothing saved when the drawing has no ink', () => {
    const service = new HandwritingService(new HandwritingEditor(), 'pdf:1', rect);
    service.setSession('ink-a');
    expect(service.endSession()).toBe(false);
  });
});

describe('HandwritingService stored precision', () => {
  it('keeps committed points to a tenth of a pixel, so synced ink stays small', () => {
    const editor = new HandwritingEditor();
    const service = new HandwritingService(editor, 'pdf:1', rect);
    (service as unknown as { onBatch: (p: InkPoint[], k: string, e: boolean) => void }).onBatch(
      [
        [0.123456789, 0.5, 0.333333],
        [0.456789123, 0.987654321, 0.666666],
      ],
      'end',
      false,
    );
    const [stroke] = editor.strokes('pdf:1');
    expect(stroke!.points).toEqual([
      [0.1235, 0.5, 0.33],
      [0.4568, 0.9877, 0.67],
    ]);
  });
});
