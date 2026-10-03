import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import type { MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from 'react';

import { useDrag } from '@/hooks/useDrag';

type Api = ReturnType<typeof useDrag>;

const setup = (onMove = vi.fn(), onEnd = vi.fn()) => {
  let api: Api = null as unknown as Api;
  function Wrapper() {
    api = useDrag(onMove, vi.fn(), onEnd);
    return null;
  }
  render(<Wrapper />);
  return { getApi: () => api, onMove, onEnd };
};

const startMouseDrag = (api: Api, clientX = 100) => {
  act(() => {
    api.handleDragStart({ clientX, clientY: 0 } as unknown as ReactMouseEvent);
  });
};

const fireWindowMouse = (type: string, clientX: number, clientY = 0) => {
  act(() => {
    window.dispatchEvent(new MouseEvent(type, { clientX, clientY, bubbles: true }));
  });
};

const startTouchDrag = (api: Api, clientY = 0) => {
  act(() => {
    api.handleDragStart({ touches: [{ clientX: 0, clientY }] } as unknown as ReactTouchEvent);
  });
};

// jsdom has no Touch/TouchEvent constructors; the hook only reads
// touches[0] / changedTouches[0], so a plain Event with the fields grafted on is
// a faithful stand-in.
const fireWindowTouch = (type: string, clientY: number) => {
  act(() => {
    const event = new Event(type, { bubbles: true });
    const touch = { clientX: 0, clientY };
    Object.assign(event, { touches: [touch], changedTouches: [touch] });
    window.dispatchEvent(event);
  });
};

const getShield = () => document.querySelector<HTMLElement>('.drag-shield');

describe('useDrag', () => {
  afterEach(() => {
    cleanup();
    document.body.style.cssText = '';
    document.documentElement.style.cssText = '';
  });

  it('keeps a top-most pointer-capturing shield above the content while dragging so a release over a PDF iframe still ends the drag (readest#5043)', () => {
    const { getApi } = setup();
    expect(getShield()).toBeNull();

    startMouseDrag(getApi());

    const shield = getShield();
    expect(shield).not.toBeNull();
    // Must sit above the book iframes (sidebar is z-[45]) and stay interactive
    // even though PDF pages set inline pointer-events:auto on their iframes.
    expect(shield!.style.position).toBe('fixed');
    expect(shield!.style.pointerEvents).toBe('auto');
    expect(Number(shield!.style.zIndex)).toBeGreaterThan(45);
  });

  it('removes the shield and stops resizing once the pointer is released', () => {
    const { getApi, onMove, onEnd } = setup();
    startMouseDrag(getApi());

    fireWindowMouse('mousemove', 150);
    expect(onMove).toHaveBeenCalledTimes(1);

    fireWindowMouse('mouseup', 150);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(getShield()).toBeNull();

    // No further resizing after release.
    fireWindowMouse('mousemove', 200);
    expect(onMove).toHaveBeenCalledTimes(1);
  });

  // The system can take a touch away mid-drag — an edge-swipe back gesture, the
  // notification shade, an incoming call. Only `touchend` used to tear the drag
  // down, so a cancel left the viewport-wide shield installed and every tap
  // afterwards landed on it instead of the app.
  it('tears the drag down when the system cancels the touch', () => {
    const { getApi, onMove, onEnd } = setup();
    startTouchDrag(getApi());
    fireWindowTouch('touchmove', 60);
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(getShield()).not.toBeNull();

    fireWindowTouch('touchcancel', 60);

    expect(getShield()).toBeNull();
    expect(document.body.style.userSelect).toBe('');
    expect(onEnd).toHaveBeenCalledTimes(1);
    // Consumers must be able to tell a cancel from a release: a cancelled drag
    // is not a decision, so it must not be read as one.
    expect(onEnd.mock.calls[0]![0]!.canceled).toBe(true);

    // No further dragging after the cancel.
    fireWindowTouch('touchmove', 200);
    expect(onMove).toHaveBeenCalledTimes(1);
  });

  it('reports a released drag as not cancelled', () => {
    const { getApi, onEnd } = setup();
    startMouseDrag(getApi());

    fireWindowMouse('mouseup', 150);

    expect(onEnd.mock.calls[0]![0]!.canceled).toBe(false);
  });
});
