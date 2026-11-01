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

  it('keeps no pressure for a finger, which reports none worth drawing with', () => {
    const { el, points } = setup();

    dispatch(el, 'pointerdown', { pointerId: 7, pointerType: 'touch', pressure: 0.1 });
    dispatch(el, 'pointerup', { pointerId: 7, pointerType: 'touch' });

    expect(points.every((p) => p.length === 2)).toBe(true);
  });

  it('reserves touch for navigation after the pen lifts', () => {
    const { el, points } = setup();

    dispatch(el, 'pointerdown', { pointerId: 1, pointerType: 'pen' });
    dispatch(el, 'pointerup', { pointerId: 1, pointerType: 'pen' });
    dispatch(el, 'pointerdown', { pointerId: 3, pointerType: 'touch', clientX: 70, clientY: 80 });
    dispatch(el, 'pointerup', { pointerId: 3, pointerType: 'touch' });

    expect(points).toHaveLength(1);
  });

  it('cancels finger ink when a second contact starts a gesture', () => {
    const { el, points } = setup();

    dispatch(el, 'pointerdown', { pointerId: 5, pointerType: 'touch', clientX: 10, clientY: 10 });
    dispatch(el, 'pointerdown', { pointerId: 6, pointerType: 'touch', clientX: 99, clientY: 99 });
    dispatch(el, 'pointerup', { pointerId: 5, pointerType: 'touch' });

    expect(points).toHaveLength(0);
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
    expect(onBatch).toHaveBeenCalledExactlyOnceWith([], 'cancel', false);
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

  it('takes the touch sequence so iOS cannot claim a quick tap-then-draw as its own gesture', () => {
    const el = new FakeElement();
    const backend = new PointerHandwritingBackend();
    backend.attach(el as unknown as HTMLElement, identity);
    const start = new Event('touchstart', { cancelable: true });
    const move = new Event('touchmove', { cancelable: true });
    el.dispatchEvent(start);
    el.dispatchEvent(move);
    expect(start.defaultPrevented).toBe(true);
    expect(move.defaultPrevented).toBe(true);

    backend.detach();
    const after = new Event('touchstart', { cancelable: true });
    el.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
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

describe('stylus input regressions (#7147)', () => {
  it('uses the S Pen barrel button as a temporary eraser', () => {
    const el = new FakeElement();
    const backend = new PointerHandwritingBackend();
    const batch = vi.fn();
    backend.onBatch(batch);
    backend.attach(el as unknown as HTMLElement, identity);
    dispatch(el, 'pointerdown', { buttons: 3, button: 2 });
    dispatch(el, 'pointerup', {});
    expect(batch).toHaveBeenLastCalledWith(expect.any(Array), 'end', true);
    dispatch(el, 'pointerdown', { buttons: 1 });
    dispatch(el, 'pointerup', {});
    expect(batch).toHaveBeenLastCalledWith(expect.any(Array), 'end', false);
  });

  it('does not draw a resting palm after a pen stroke', () => {
    const el = new FakeElement();
    const backend = new PointerHandwritingBackend();
    const batch = vi.fn();
    backend.onBatch(batch);
    backend.attach(el as unknown as HTMLElement, identity);
    dispatch(el, 'pointerdown', {});
    dispatch(el, 'pointerup', {});
    batch.mockClear();
    dispatch(el, 'pointerdown', { pointerType: 'touch', pointerId: 8 });
    dispatch(el, 'pointerup', { pointerType: 'touch', pointerId: 8 });
    expect(batch).not.toHaveBeenCalled();
  });

  it('keeps a sample when getCoalescedEvents returns an empty array', () => {
    const el = new FakeElement();
    const backend = new PointerHandwritingBackend();
    const batch = vi.fn();
    backend.onBatch(batch);
    backend.attach(el as unknown as HTMLElement, identity);
    dispatch(el, 'pointerdown', { pressure: 0.2 });
    dispatch(el, 'pointermove', { pressure: 0.9, clientX: 5, getCoalescedEvents: () => [] });
    dispatch(el, 'pointerup', {});
    expect(batch.mock.calls[0]![0]).toEqual([
      [0, 0, 0.2],
      [5, 0, 0.9],
    ]);
  });
});

describe('finger gestures while drawing', () => {
  const setup = () => {
    const el = new FakeElement();
    const backend = new PointerHandwritingBackend();
    const gesture = vi.fn();
    const batch = vi.fn();
    backend.onBatch(batch);
    backend.onGesture(gesture);
    backend.attach(el as unknown as HTMLElement, identity);
    dispatch(el, 'pointerover', {});
    return { el, backend, gesture, batch };
  };
  const touch = (el: FakeElement, type: string, id: number, x = id * 20, y = 10) =>
    dispatch(el, type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y });

  it.each([2, 3])('uses a %i-finger tap for history without ink', (count) => {
    const { el, gesture, batch } = setup();
    for (let i = 1; i <= count; i++) touch(el, 'pointerdown', i);
    // Each finger can wobble without moving the gesture beyond its tap slop.
    for (let i = 1; i <= count; i++) touch(el, 'pointermove', i, i * 20 + 1);
    for (let i = 1; i <= count; i++) touch(el, 'pointerup', i);
    expect(gesture).toHaveBeenCalledExactlyOnceWith({ action: count === 2 ? 'undo' : 'redo' });
    expect(batch).not.toHaveBeenCalled();
  });

  it('navigates with a finger swipe after detecting a pen', () => {
    const { el, gesture, batch } = setup();
    touch(el, 'pointerdown', 1, 100);
    touch(el, 'pointermove', 1, 40);
    touch(el, 'pointerup', 1, 40);
    expect(gesture).toHaveBeenCalledExactlyOnceWith({ action: 'swipe', dx: -60, dy: 0 });
    expect(batch).not.toHaveBeenCalled();
  });

  it('ignores a moving palm even if the pen lifts before the palm', () => {
    const { el, gesture } = setup();
    dispatch(el, 'pointerdown', { pointerId: 10 });
    touch(el, 'pointerdown', 1, 100);
    dispatch(el, 'pointerup', { pointerId: 10 });
    touch(el, 'pointermove', 1, 20);
    touch(el, 'pointerup', 1, 20);
    expect(gesture).not.toHaveBeenCalled();
  });

  it('rejects multi-finger drags and cancelled gestures', () => {
    const { el, gesture } = setup();
    touch(el, 'pointerdown', 1);
    touch(el, 'pointerdown', 2);
    touch(el, 'pointermove', 1, 150);
    touch(el, 'pointerup', 1, 150);
    touch(el, 'pointerup', 2);
    touch(el, 'pointerdown', 1);
    touch(el, 'pointerdown', 2);
    touch(el, 'pointercancel', 1);
    touch(el, 'pointerup', 2);
    expect(gesture).not.toHaveBeenCalled();
  });

  it('splits strokes when the barrel button changes during contact', () => {
    const { el, batch } = setup();
    dispatch(el, 'pointerdown', { pointerId: 10, buttons: 1 });
    dispatch(el, 'pointermove', { pointerId: 10, buttons: 3, clientX: 5 });
    expect(batch).toHaveBeenLastCalledWith([[0, 0, 0.5]], 'end', false);
    dispatch(el, 'pointerup', { pointerId: 10 });
    expect(batch).toHaveBeenLastCalledWith([[5, 0, 0.5]], 'end', true);
  });

  it('detach drops pending input before reattaching', () => {
    const { el, backend, batch } = setup();
    dispatch(el, 'pointerdown', {});
    backend.detach();
    expect(batch).toHaveBeenLastCalledWith([], 'cancel', false);
    backend.attach(el as unknown as HTMLElement, identity);
    dispatch(el, 'pointerdown', { clientX: 9 });
    dispatch(el, 'pointerup', {});
    expect(batch).toHaveBeenLastCalledWith([[9, 0, 0.5]], 'end', false);
  });
});
