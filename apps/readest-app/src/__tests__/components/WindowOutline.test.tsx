import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import WindowOutline, { RESIZE_SETTLE_MS } from '@/components/WindowOutline';

let needsClientOutline = false;
let maximized = false;
let fullscreen = false;
let resizedHandlers: Array<() => void> = [];

const { getCurrentWindow, unlisten } = vi.hoisted(() => ({
  getCurrentWindow: vi.fn(),
  unlisten: vi.fn(),
}));

vi.mock('@/utils/window', () => ({
  windowNeedsClientOutline: () => needsClientOutline,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: {} }),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => getCurrentWindow(),
}));

function windowState(size: { width: number; height: number } = { width: 1024, height: 768 }) {
  const win = {
    isMaximized: vi.fn().mockImplementation(async () => maximized),
    isFullscreen: vi.fn().mockImplementation(async () => fullscreen),
    onResized: vi.fn().mockImplementation((handler: () => void) => {
      resizedHandlers.push(handler);
      return Promise.resolve(unlisten);
    }),
    innerSize: vi.fn().mockImplementation(async () => size),
  };
  getCurrentWindow.mockReturnValue(win);
  return win;
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Let the window look idle long enough for the outline to be measured. */
async function settled() {
  await advance(RESIZE_SETTLE_MS + 50);
}

function scaleFactor(dpr: number) {
  Object.defineProperty(window, 'devicePixelRatio', { value: dpr, configurable: true });
}

/** A resize that is still in flight: the outline goes, and nothing is measured. */
function drag() {
  act(() => {
    for (const handler of resizedHandlers) handler();
  });
}

function pageResize() {
  act(() => {
    window.dispatchEvent(new Event('resize'));
  });
}

async function resizeTo(next: { maximized: boolean; fullscreen: boolean }) {
  maximized = next.maximized;
  fullscreen = next.fullscreen;
  drag();
  await settled();
}

function outlineStyle(container: HTMLElement) {
  const outline = container.querySelector<HTMLElement>('.window-outline');
  expect(outline).not.toBeNull();
  return outline!.style;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
  resizedHandlers = [];
  needsClientOutline = false;
  maximized = false;
  fullscreen = false;
  scaleFactor(1);
});

describe('WindowOutline', () => {
  it('stays out of the way where the OS already draws a frame', async () => {
    needsClientOutline = false;
    const { container } = render(<WindowOutline />);

    await settled();

    expect(container.firstChild).toBeNull();
    expect(getCurrentWindow).not.toHaveBeenCalled();
  });

  it('draws the outline once the window has settled', async () => {
    needsClientOutline = true;
    windowState();

    const { container } = render(<WindowOutline />);
    expect(container.firstChild).toBeNull();

    await settled();

    const outline = container.querySelector('.window-outline');
    expect(outline).not.toBeNull();
    expect(outline!.getAttribute('aria-hidden')).toBe('true');
  });

  it('hides the outline while maximized or fullscreen', async () => {
    needsClientOutline = true;
    maximized = true;
    windowState();

    const { container } = render(<WindowOutline />);
    await settled();
    expect(container.querySelector('.window-outline')).toBeNull();

    await resizeTo({ maximized: false, fullscreen: true });
    expect(container.querySelector('.window-outline')).toBeNull();

    await resizeTo({ maximized: false, fullscreen: false });
    expect(container.querySelector('.window-outline')).not.toBeNull();
  });

  it('sizes the box from the window, not from the page', async () => {
    needsClientOutline = true;
    // The page itself lays this out 1030 CSS pixels wide, a pixel past the
    // 1544-device-pixel window, because a viewport is whole CSS pixels and a
    // window is whole device pixels.
    windowState({ width: 1544, height: 979 });
    scaleFactor(1.5);

    const { container } = render(<WindowOutline />);
    await settled();

    const style = outlineStyle(container);
    expect(parseFloat(style.width)).toBeCloseTo(1544 / 1.5, 5);
    expect(parseFloat(style.height)).toBeCloseTo(979 / 1.5, 5);
  });

  it('sizes the box one-to-one where the scale factor divides the window', async () => {
    needsClientOutline = true;
    windowState({ width: 1545, height: 978 });
    scaleFactor(1);

    const { container } = render(<WindowOutline />);
    await settled();

    const style = outlineStyle(container);
    expect(style.width).toBe('1545px');
    expect(style.height).toBe('978px');
  });

  it('measures nothing while the window is still moving', async () => {
    needsClientOutline = true;
    const win = windowState({ width: 1544, height: 979 });
    scaleFactor(1.5);

    const { container } = render(<WindowOutline />);
    await settled();
    expect(win.innerSize).toHaveBeenCalledTimes(1);

    win.innerSize.mockImplementation(async () => ({ width: 1200, height: 800 }));
    drag();
    expect(container.querySelector('.window-outline')).toBeNull();
    expect(win.innerSize).toHaveBeenCalledTimes(1);

    await settled();
    const style = outlineStyle(container);
    expect(parseFloat(style.width)).toBeCloseTo(1200 / 1.5, 5);
    expect(parseFloat(style.height)).toBeCloseTo(800 / 1.5, 5);
  });

  it('redraws when the page catches up, at the scale factor it caught up with', async () => {
    needsClientOutline = true;
    const win = windowState({ width: 1544, height: 979 });
    scaleFactor(1.5);

    const { container } = render(<WindowOutline />);
    await settled();
    expect(parseFloat(outlineStyle(container).width)).toBeCloseTo(1544 / 1.5, 5);

    // Dragging the window onto a 100% monitor moves the device pixels the same
    // window size stands for, and only the page knows it has been told.
    scaleFactor(1);
    pageResize();
    expect(container.querySelector('.window-outline')).toBeNull();

    await settled();
    expect(win.innerSize).toHaveBeenCalledTimes(2);
    expect(outlineStyle(container).width).toBe('1544px');
  });

  it('stops listening when unmounted', async () => {
    needsClientOutline = true;
    const win = windowState();

    const { unmount } = render(<WindowOutline />);
    await settled();

    expect(win.onResized).toHaveBeenCalledTimes(1);
    expect(win.innerSize).toHaveBeenCalledTimes(1);

    unmount();
    expect(unlisten).toHaveBeenCalledTimes(1);

    pageResize();
    drag();
    await settled();
    expect(win.innerSize).toHaveBeenCalledTimes(1);
  });

  it('discards a measurement still in flight when the window moves again', async () => {
    needsClientOutline = true;
    const win = windowState({ width: 1544, height: 979 });
    scaleFactor(1.5);
    let resolveSize: ((size: { width: number; height: number }) => void) | undefined;
    win.innerSize.mockImplementation(
      () =>
        new Promise<{ width: number; height: number }>((resolve) => {
          resolveSize = resolve;
        }),
    );

    const { container } = render(<WindowOutline />);
    await settled();
    expect(win.innerSize).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.window-outline')).toBeNull();

    // The window moves while that read is outstanding; its answer is about the
    // size the window had before, so it must not put a frame back up.
    drag();
    await act(async () => {
      resolveSize?.({ width: 1200, height: 800 });
    });

    expect(container.querySelector('.window-outline')).toBeNull();
  });

  it('says nothing when the window refuses to be read', async () => {
    needsClientOutline = true;
    const win = windowState();
    // A window torn down mid-flight rejects its reads; nothing awaits them here, so
    // an unhandled rejection would land on the page instead of a quiet outline.
    win.isMaximized.mockImplementation(() => Promise.reject(new Error('no such window')));

    const { container } = render(<WindowOutline />);
    await settled();

    expect(container.querySelector('.window-outline')).toBeNull();
  });

  it('keeps a fresh outline up when an overtaken measurement fails', async () => {
    needsClientOutline = true;
    const win = windowState({ width: 1544, height: 979 });
    let reads = 0;
    let rejectStale: ((error: Error) => void) | undefined;
    win.innerSize.mockImplementation(() => {
      reads += 1;
      if (reads === 1) {
        // Left outstanding, then rejected after the newer measurement has drawn its
        // own frame: its failure belongs to a window size that is already history.
        return new Promise<{ width: number; height: number }>((_, reject) => {
          rejectStale = reject;
        });
      }
      return Promise.resolve({ width: 1200, height: 800 });
    });

    const { container } = render(<WindowOutline />);
    await settled();
    expect(win.innerSize).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.window-outline')).toBeNull();

    drag();
    await settled();
    expect(win.innerSize).toHaveBeenCalledTimes(2);
    expect(outlineStyle(container).width).toBe('1200px');

    await act(async () => {
      rejectStale?.(new Error('no such window'));
    });
    expect(container.querySelector('.window-outline')).not.toBeNull();
  });

  it('measures anyway when only the resize listener fails to register', async () => {
    needsClientOutline = true;
    const win = windowState();
    win.onResized.mockImplementation(() => Promise.reject(new Error('no event sink')));

    const { container } = render(<WindowOutline />);
    await settled();

    expect(outlineStyle(container).width).toBe('1024px');

    pageResize();
    await settled();
    expect(win.innerSize).toHaveBeenCalledTimes(2);
  });
});
