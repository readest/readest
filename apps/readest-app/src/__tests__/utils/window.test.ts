import { describe, test, expect, beforeEach, vi } from 'vitest';

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(),
  getAllWindows: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  emitTo: vi.fn().mockResolvedValue(undefined),
  TauriEvent: { WINDOW_FOCUS: 'tauri://focus' },
}));

vi.mock('@tauri-apps/plugin-process', () => ({
  exit: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-os', () => ({
  type: vi.fn(),
}));

vi.mock('@/utils/event', () => ({
  eventDispatcher: { dispatch: vi.fn() },
}));

import { getCurrentWindow } from '@tauri-apps/api/window';
import { type as osType } from '@tauri-apps/plugin-os';
import { tauriHandleOnCloseWindow } from '@/utils/window';

type CloseHandler = (event: { preventDefault: () => void }) => Promise<void> | void;

function makeWindow(label: string) {
  let registered: CloseHandler | undefined;
  const win = {
    label,
    destroy: vi.fn().mockResolvedValue(undefined),
    hide: vi.fn().mockResolvedValue(undefined),
    onCloseRequested: vi.fn().mockImplementation((handler: CloseHandler) => {
      registered = handler;
      return Promise.resolve(() => {});
    }),
  };
  const trigger = async () => {
    if (!registered) throw new Error('no handler registered');
    await registered({ preventDefault: vi.fn() });
  };
  return { win, trigger };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

describe('tauriHandleOnCloseWindow', () => {
  test('on macOS, leaves the main window alone — no book cleanup, no destroy', async () => {
    // Rust hide-on-close handler hides the window; the user expects the active
    // book to still be loaded when they bring the window back.
    vi.mocked(osType).mockReturnValue('macos');
    const { win, trigger } = makeWindow('main');
    vi.mocked(getCurrentWindow).mockReturnValue(
      win as unknown as ReturnType<typeof getCurrentWindow>,
    );

    const callback = vi.fn();
    await tauriHandleOnCloseWindow(callback);
    await trigger();

    expect(callback).not.toHaveBeenCalled();
    expect(win.destroy).not.toHaveBeenCalled();
  });

  test('on Windows, destroys the main window', async () => {
    vi.mocked(osType).mockReturnValue('windows');
    const { win, trigger } = makeWindow('main');
    vi.mocked(getCurrentWindow).mockReturnValue(
      win as unknown as ReturnType<typeof getCurrentWindow>,
    );

    const callback = vi.fn();
    await tauriHandleOnCloseWindow(callback);
    await trigger();

    expect(win.destroy).toHaveBeenCalled();
  });

  test('on Linux, destroys the main window', async () => {
    vi.mocked(osType).mockReturnValue('linux');
    const { win, trigger } = makeWindow('main');
    vi.mocked(getCurrentWindow).mockReturnValue(
      win as unknown as ReturnType<typeof getCurrentWindow>,
    );

    const callback = vi.fn();
    await tauriHandleOnCloseWindow(callback);
    await trigger();

    expect(win.destroy).toHaveBeenCalled();
  });

  test('on macOS, dedicated reader windows still destroy after 300ms', async () => {
    vi.mocked(osType).mockReturnValue('macos');
    const { win, trigger } = makeWindow('reader-0');
    vi.mocked(getCurrentWindow).mockReturnValue(
      win as unknown as ReturnType<typeof getCurrentWindow>,
    );

    const callback = vi.fn();
    await tauriHandleOnCloseWindow(callback);
    await trigger();

    expect(win.destroy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(win.destroy).toHaveBeenCalled();
  });
});
