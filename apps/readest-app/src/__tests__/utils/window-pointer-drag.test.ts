import { describe, expect, test } from 'vitest';
import { isLinuxCefRuntime } from '@/utils/ua';
import { computeResizedFrame, type ResizeEdge } from '@/utils/windowPointerDrag';

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
