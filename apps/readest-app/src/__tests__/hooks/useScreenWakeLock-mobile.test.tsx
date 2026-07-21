import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const unlisten = vi.fn();
  const release = vi.fn().mockResolvedValue(undefined);
  const request = vi.fn().mockResolvedValue({ addEventListener: vi.fn(), release });
  const onFocusChanged = vi.fn().mockResolvedValue(unlisten);
  return {
    unlisten,
    release,
    request,
    onFocusChanged,
    getCurrentWindow: vi.fn(() => ({ onFocusChanged })),
  };
});

vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: mocks.getCurrentWindow }));
vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => true,
  isWebAppPlatform: () => false,
}));

import { useScreenWakeLock } from '@/hooks/useScreenWakeLock';

describe('useScreenWakeLock on mobile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: { request: mocks.request },
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('uses document visibility instead of the unavailable Tauri Window API', () => {
    const addEventListener = vi.spyOn(document, 'addEventListener');

    renderHook(() => useScreenWakeLock(true, false));

    expect(mocks.getCurrentWindow).not.toHaveBeenCalled();
    expect(addEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });

  it('uses window focus events when the desktop Window API is available', async () => {
    const { unmount } = renderHook(() => useScreenWakeLock(true, true));

    expect(mocks.getCurrentWindow).toHaveBeenCalledOnce();
    expect(mocks.onFocusChanged).toHaveBeenCalledOnce();
    await waitFor(() => expect(mocks.request).toHaveBeenCalledOnce());

    const handleFocusChanged = mocks.onFocusChanged.mock.calls[0]![0] as (event: {
      payload: boolean;
    }) => void;
    handleFocusChanged({ payload: false });
    expect(mocks.release).toHaveBeenCalledOnce();

    handleFocusChanged({ payload: true });
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));

    await act(async () => {
      unmount();
      await Promise.resolve();
    });

    expect(mocks.unlisten).toHaveBeenCalledOnce();
  });

  it('releases and reacquires the wake lock as document visibility changes', async () => {
    let hidden = false;
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    renderHook(() => useScreenWakeLock(true, false));

    await waitFor(() => expect(mocks.request).toHaveBeenCalledOnce());

    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(mocks.release).toHaveBeenCalledOnce();

    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
  });

  it('switches from document visibility to window focus events when capability appears', () => {
    const removeEventListener = vi.spyOn(document, 'removeEventListener');
    const { rerender } = renderHook(
      ({ hasWindow }: { hasWindow: boolean }) => useScreenWakeLock(true, hasWindow),
      { initialProps: { hasWindow: false } },
    );

    rerender({ hasWindow: true });

    expect(removeEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(mocks.getCurrentWindow).toHaveBeenCalledOnce();
  });

  it('releases a stale acquisition without losing the current wake lock', async () => {
    type TestSentinel = {
      addEventListener: ReturnType<typeof vi.fn>;
      release: ReturnType<typeof vi.fn>;
    };
    let resolveStale!: (sentinel: TestSentinel) => void;
    const staleSentinel: TestSentinel = {
      addEventListener: vi.fn(),
      release: vi.fn().mockResolvedValue(undefined),
    };
    const currentSentinel: TestSentinel = {
      addEventListener: vi.fn(),
      release: vi.fn().mockResolvedValue(undefined),
    };
    mocks.request
      .mockReturnValueOnce(new Promise((resolve) => (resolveStale = resolve)))
      .mockResolvedValueOnce(currentSentinel);

    const { rerender, unmount } = renderHook(
      ({ hasWindow }: { hasWindow: boolean }) => useScreenWakeLock(true, hasWindow),
      { initialProps: { hasWindow: false } },
    );
    rerender({ hasWindow: true });
    await waitFor(() => expect(currentSentinel.addEventListener).toHaveBeenCalledOnce());

    resolveStale(staleSentinel);
    await waitFor(() => expect(staleSentinel.release).toHaveBeenCalledOnce());

    unmount();
    expect(currentSentinel.release).toHaveBeenCalledOnce();
  });

  it('retries after a wake-lock acquisition failure', async () => {
    let hidden = false;
    const currentSentinel = {
      addEventListener: vi.fn(),
      release: vi.fn().mockResolvedValue(undefined),
    };
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    mocks.request
      .mockRejectedValueOnce(new Error('transient acquisition failure'))
      .mockResolvedValueOnce(currentSentinel);
    renderHook(() => useScreenWakeLock(true, false));
    await waitFor(() => expect(info).toHaveBeenCalledOnce());

    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));

    await waitFor(() => expect(currentSentinel.addEventListener).toHaveBeenCalledOnce());
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });

  it('ignores a delayed release event from an old sentinel', async () => {
    let hidden = false;
    let oldReleaseListener!: () => void;
    const oldSentinel = {
      addEventListener: vi.fn((_event: string, listener: () => void) => {
        oldReleaseListener = listener;
      }),
      release: vi.fn().mockResolvedValue(undefined),
    };
    const currentSentinel = {
      addEventListener: vi.fn(),
      release: vi.fn().mockResolvedValue(undefined),
    };
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    mocks.request.mockResolvedValueOnce(oldSentinel).mockResolvedValueOnce(currentSentinel);
    const { unmount } = renderHook(() => useScreenWakeLock(true, false));
    await waitFor(() => expect(oldSentinel.addEventListener).toHaveBeenCalledOnce());

    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(currentSentinel.addEventListener).toHaveBeenCalledOnce());

    oldReleaseListener();
    unmount();
    expect(currentSentinel.release).toHaveBeenCalledOnce();
  });

  it('contains a rejected desktop focus-listener registration', async () => {
    const error = new Error('focus listener unavailable');
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    mocks.onFocusChanged.mockRejectedValueOnce(error);

    const { unmount } = renderHook(() => useScreenWakeLock(true, true));

    await waitFor(() => {
      expect(info).toHaveBeenCalledWith('Failed to register window focus listener:', error);
    });
    unmount();
  });
});
