import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import WindowOutline from '@/components/WindowOutline';

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

function windowState() {
  const win = {
    isMaximized: vi.fn().mockImplementation(async () => maximized),
    isFullscreen: vi.fn().mockImplementation(async () => fullscreen),
    onResized: vi.fn().mockImplementation((handler: () => void) => {
      resizedHandlers.push(handler);
      return Promise.resolve(unlisten);
    }),
  };
  getCurrentWindow.mockReturnValue(win);
  return win;
}

async function emitResized(next: { maximized: boolean; fullscreen: boolean }) {
  maximized = next.maximized;
  fullscreen = next.fullscreen;
  await act(async () => {
    for (const handler of resizedHandlers) await handler();
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  resizedHandlers = [];
  needsClientOutline = false;
  maximized = false;
  fullscreen = false;
});

describe('WindowOutline', () => {
  it('stays out of the way where the OS already draws a frame', async () => {
    needsClientOutline = false;
    const { container } = render(<WindowOutline />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.firstChild).toBeNull();
    expect(getCurrentWindow).not.toHaveBeenCalled();
  });

  it('draws the outline on a restored Windows 10 window', async () => {
    needsClientOutline = true;
    windowState();

    const { container } = render(<WindowOutline />);
    await act(async () => {
      await Promise.resolve();
    });

    const outline = container.querySelector('.window-outline');
    expect(outline).not.toBeNull();
    expect(outline!.getAttribute('aria-hidden')).toBe('true');
  });

  it('hides the outline while maximized or fullscreen', async () => {
    needsClientOutline = true;
    maximized = true;
    windowState();

    const { container } = render(<WindowOutline />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.querySelector('.window-outline')).toBeNull();

    await emitResized({ maximized: false, fullscreen: true });
    expect(container.querySelector('.window-outline')).toBeNull();

    await emitResized({ maximized: false, fullscreen: false });
    expect(container.querySelector('.window-outline')).not.toBeNull();
  });

  it('stops listening when unmounted', async () => {
    needsClientOutline = true;
    const win = windowState();

    const { unmount } = render(<WindowOutline />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(win.onResized).toHaveBeenCalledTimes(1);
    unmount();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
