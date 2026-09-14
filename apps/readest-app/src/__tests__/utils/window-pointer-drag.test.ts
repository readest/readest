import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { isLinuxCefRuntime } from '@/utils/ua';
import {
  computeResizedFrame,
  type ResizeEdge,
  startPointerWindowMove,
} from '@/utils/windowPointerDrag';

const CEF_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const WEBKITGTK_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/151.0.0.0 Mobile Safari/537.36';
const WEBVIEW2_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0';

describe('isLinuxCefRuntime', () => {
  test('matches the Chromium user agent of the Linux CEF build only', () => {
    expect(isLinuxCefRuntime(CEF_UA)).toBe(true);
    expect(isLinuxCefRuntime(WEBKITGTK_UA)).toBe(false);
    expect(isLinuxCefRuntime(ANDROID_UA)).toBe(false);
    expect(isLinuxCefRuntime(WEBVIEW2_UA)).toBe(false);
  });
});

describe('computeResizedFrame', () => {
  const start = { x: 100, y: 200, width: 800, height: 600 };
  const min = { width: 400, height: 300 };
  const frame = (edge: ResizeEdge, dx: number, dy: number) =>
    computeResizedFrame(edge, start, { dx, dy }, min);

  test('east and south edges grow the size and keep the origin', () => {
    expect(frame('e', 50, 999)).toEqual({ x: 100, y: 200, width: 850, height: 600 });
    expect(frame('s', 999, 40)).toEqual({ x: 100, y: 200, width: 800, height: 640 });
    expect(frame('se', 50, 40)).toEqual({ x: 100, y: 200, width: 850, height: 640 });
  });

  test('west and north edges move the origin with the edge', () => {
    expect(frame('w', -50, 0)).toEqual({ x: 50, y: 200, width: 850, height: 600 });
    expect(frame('n', 0, -40)).toEqual({ x: 100, y: 160, width: 800, height: 640 });
    expect(frame('nw', 30, 20)).toEqual({ x: 130, y: 220, width: 770, height: 580 });
  });

  test('never shrinks below the minimum size, pinning the moving edge', () => {
    expect(frame('e', -500, 0)).toEqual({ x: 100, y: 200, width: 400, height: 600 });
    expect(frame('w', 500, 0)).toEqual({ x: 500, y: 200, width: 400, height: 600 });
    expect(frame('n', 0, 500)).toEqual({ x: 100, y: 500, width: 800, height: 300 });
  });
});

const windowMock = {
  isMaximized: vi.fn(),
  outerPosition: vi.fn(),
  outerSize: vi.fn(),
  scaleFactor: vi.fn(),
  setPosition: vi.fn(),
  setSize: vi.fn(),
};

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => windowMock,
  PhysicalPosition: class {
    constructor(
      public x: number,
      public y: number,
    ) {}
  },
  PhysicalSize: class {
    constructor(
      public width: number,
      public height: number,
    ) {}
  },
}));

const mouse = (type: string, screenX: number, screenY: number) =>
  window.dispatchEvent(new MouseEvent(type, { screenX, screenY }));

describe('startPointerWindowMove', () => {
  let frames: FrameRequestCallback[];

  beforeEach(() => {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    windowMock.isMaximized.mockResolvedValue(false);
    windowMock.outerPosition.mockResolvedValue({ x: 100, y: 200 });
    windowMock.scaleFactor.mockResolvedValue(1);
    windowMock.setPosition.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('applies the final pointer delta when the button is released before the next frame', async () => {
    await startPointerWindowMove(new MouseEvent('mousedown', { screenX: 10, screenY: 10 }));
    mouse('mousemove', 40, 25);
    mouse('mouseup', 40, 25);
    expect(windowMock.setPosition).toHaveBeenCalledTimes(1);
    expect(windowMock.setPosition.mock.calls[0]![0]).toMatchObject({ x: 130, y: 215 });
  });

  test('does not track the pointer when the button was released while the window state loaded', async () => {
    let resolvePosition: (value: { x: number; y: number }) => void = () => {};
    windowMock.outerPosition.mockReturnValue(
      new Promise<{ x: number; y: number }>((resolve) => {
        resolvePosition = resolve;
      }),
    );
    const started = startPointerWindowMove(
      new MouseEvent('mousedown', { screenX: 10, screenY: 10 }),
    );
    await Promise.resolve();
    mouse('mouseup', 10, 10);
    resolvePosition({ x: 100, y: 200 });
    await started;
    mouse('mousemove', 60, 60);
    frames.forEach((cb) => cb(0));
    expect(windowMock.setPosition).not.toHaveBeenCalled();
  });
});
