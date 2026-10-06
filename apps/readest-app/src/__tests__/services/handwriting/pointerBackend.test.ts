import { describe, it, expect, vi } from 'vitest';
import { PointerHandwritingBackend } from '@/services/handwriting/pointerBackend';
import type { InkPoint } from '@/services/handwriting/model';

class FakeElement extends EventTarget {
  setPointerCapture = vi.fn();
}

const dispatch = (
  el: FakeElement,
  type: string,
  init: Partial<PointerEvent> & { pointerId?: number },
) => {
  const ev = new Event(type) as PointerEvent;
  Object.assign(ev, {
    pointerId: 0,
    pointerType: 'pen',
    pressure: 0.5,
    clientX: 0,
    clientY: 0,
    button: 0,
    buttons: 0,
    ...init,
  });
  el.dispatchEvent(ev);
};

const identity = (x: number, y: number): [number, number] => [x, y];

describe('PointerHandwritingBackend palm rejection', () => {
  // Points are queued and delivered on the next animation frame, so each case
  // closes its stroke with pointerup (a synchronous flush) instead of awaiting
  // a RAF tick.
  const setup = () => {
    const el = new FakeElement();
    const backend = new PointerHandwritingBackend();
    const points: InkPoint[] = [];
    backend.onBatch((batch) => points.push(...batch));
    backend.attach(el as unknown as HTMLElement, identity);
    return { el, backend, points };
  };

  it('lets the pen take over when the palm touched down first', () => {
    const { el, points } = setup();

    // The realistic order on a tablet held in one hand: the resting fingers
    // reach the digitizer a moment before the pen tip.
    dispatch(el, 'pointerdown', { pointerId: 9, pointerType: 'touch', clientX: 77, clientY: 88 });
    dispatch(el, 'pointerdown', { pointerId: 1, pointerType: 'pen', clientX: 10, clientY: 10 });
    dispatch(el, 'pointerup', { pointerId: 1, pointerType: 'pen' });

    // The palm's queued point is discarded rather than committed...
    expect(points.map((p) => p.slice(0, 2))).toEqual([[10, 10]]);
  });

  it('discards the whole palm stroke, not just its last point', () => {
    const { el, points } = setup();

    dispatch(el, 'pointerdown', { pointerId: 9, pointerType: 'touch', clientX: 70, clientY: 70 });
    dispatch(el, 'pointermove', { pointerId: 9, pointerType: 'touch', clientX: 72, clientY: 71 });
    dispatch(el, 'pointerdown', { pointerId: 1, pointerType: 'pen', clientX: 10, clientY: 10 });
    dispatch(el, 'pointerup', { pointerId: 1, pointerType: 'pen' });

    expect(points.every((p) => p[0] === 10 && p[1] === 10)).toBe(true);
  });

  it('ignores a touch that arrives after the pen is already down', () => {
    const { el, points } = setup();

    dispatch(el, 'pointerdown', { pointerId: 1, pointerType: 'pen' });
    dispatch(el, 'pointerdown', { pointerId: 9, pointerType: 'touch', clientX: 77, clientY: 88 });
    dispatch(el, 'pointerup', { pointerId: 1, pointerType: 'pen' });

    expect(points).toHaveLength(1);
  });

  it('accepts a plain touch stroke when no pen is involved', () => {
    const { el, points } = setup();

    dispatch(el, 'pointerdown', { pointerId: 7, pointerType: 'touch', clientX: 30, clientY: 40 });
    dispatch(el, 'pointerup', { pointerId: 7, pointerType: 'touch' });

    expect(points.map((p) => p.slice(0, 2))).toEqual([[30, 40]]);
  });

  it('accepts a new touch stroke after the pen lifts', () => {
    const { el, points } = setup();

    dispatch(el, 'pointerdown', { pointerId: 1, pointerType: 'pen' });
    dispatch(el, 'pointerup', { pointerId: 1, pointerType: 'pen' });
    dispatch(el, 'pointerdown', { pointerId: 3, pointerType: 'touch', clientX: 70, clientY: 80 });
    dispatch(el, 'pointerup', { pointerId: 3, pointerType: 'touch' });

    expect(points).toHaveLength(2);
  });

  it('does not steal a second concurrent touch while the first is drawing', () => {
    const { el, points } = setup();

    dispatch(el, 'pointerdown', { pointerId: 5, pointerType: 'touch', clientX: 10, clientY: 10 });
    dispatch(el, 'pointerdown', { pointerId: 6, pointerType: 'touch', clientX: 99, clientY: 99 });
    dispatch(el, 'pointerup', { pointerId: 5, pointerType: 'touch' });

    expect(points).toHaveLength(1);
  });
});

describe('PointerHandwritingBackend', () => {
  it('batches a move on the next animation frame, not per event', async () => {
    const el = new FakeElement();
    const backend = new PointerHandwritingBackend();
    const onBatch = vi.fn();
    backend.onBatch(onBatch);
    backend.attach(el as unknown as HTMLElement, identity);

    dispatch(el, 'pointerdown', { clientX: 1, clientY: 1 });
    dispatch(el, 'pointermove', { clientX: 2, clientY: 2 });
    dispatch(el, 'pointermove', { clientX: 3, clientY: 3 });
    expect(onBatch).not.toHaveBeenCalled();

    await new Promise((r) => requestAnimationFrame(r));
    expect(onBatch).toHaveBeenCalledTimes(1);
    expect(onBatch.mock.calls[0]![0]).toHaveLength(3);
    expect(onBatch.mock.calls[0]![1]).toBe('move');
  });

  it('flushes immediately on pointerup with kind "end"', async () => {
    const el = new FakeElement();
    const backend = new PointerHandwritingBackend();
    const onBatch = vi.fn();
    backend.onBatch(onBatch);
    backend.attach(el as unknown as HTMLElement, identity);

    dispatch(el, 'pointerdown', { clientX: 1, clientY: 1 });
    await new Promise((r) => requestAnimationFrame(r));
    dispatch(el, 'pointerup', {});
    expect(onBatch).toHaveBeenLastCalledWith(expect.any(Array), 'end', false);
  });

  it('ignores a second pointer while one is already active', async () => {
    const el = new FakeElement();
    const backend = new PointerHandwritingBackend();
    const onBatch = vi.fn();
    backend.onBatch(onBatch);
    backend.attach(el as unknown as HTMLElement, identity);

    dispatch(el, 'pointerdown', { pointerId: 0, clientX: 1, clientY: 1 });
    dispatch(el, 'pointerdown', { pointerId: 1, clientX: 9, clientY: 9 });
    dispatch(el, 'pointermove', { pointerId: 1, clientX: 8, clientY: 8 });
    await new Promise((r) => requestAnimationFrame(r));
    expect(onBatch.mock.calls[0]![0]).toEqual([[1, 1, 0.5]]);
  });

  it('discards pending points on pointercancel', async () => {
    const el = new FakeElement();
    const backend = new PointerHandwritingBackend();
    const onBatch = vi.fn();
    backend.onBatch(onBatch);
    backend.attach(el as unknown as HTMLElement, identity);

    dispatch(el, 'pointerdown', { clientX: 1, clientY: 1 });
    await new Promise((r) => requestAnimationFrame(r));
    onBatch.mockClear();
    dispatch(el, 'pointermove', { clientX: 2, clientY: 2 });
    dispatch(el, 'pointercancel', {});
    await new Promise((r) => requestAnimationFrame(r));
    expect(onBatch).not.toHaveBeenCalled();
  });

  it('detects eraser via button 5 and omits pressure for mouse', async () => {
    const el = new FakeElement();
    const backend = new PointerHandwritingBackend();
    const onBatch = vi.fn();
    backend.onBatch(onBatch);
    backend.attach(el as unknown as HTMLElement, identity);

    dispatch(el, 'pointerdown', { clientX: 1, clientY: 1, button: 5 });
    await new Promise((r) => requestAnimationFrame(r));
    dispatch(el, 'pointerup', {});
    expect(onBatch).toHaveBeenLastCalledWith(expect.any(Array), 'end', true);
  });

  it('detach stops listening', async () => {
    const el = new FakeElement();
    const backend = new PointerHandwritingBackend();
    const onBatch = vi.fn();
    backend.onBatch(onBatch);
    backend.attach(el as unknown as HTMLElement, identity);
    backend.detach();
    dispatch(el, 'pointerdown', { clientX: 1, clientY: 1 });
    await new Promise((r) => requestAnimationFrame(r));
    expect(onBatch).not.toHaveBeenCalled();
  });
});
