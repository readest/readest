import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

// useWindowActiveChanged reads appService.isDesktopApp to choose its
// subscription; false -> the DOM 'visibilitychange' path (jsdom-friendly).
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { isDesktopApp: false } }),
}));

import { useAutoImportFolders } from '@/app/library/hooks/useAutoImportFolders';

const DEBOUNCE_MS = 800;

// Let the async window-active subscription settle so its listener is attached.
const settle = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useAutoImportFolders', () => {
  test('scans once on mount after the debounce window', async () => {
    const scan = vi.fn(async () => {});
    renderHook(() =>
      useAutoImportFolders({ enabled: true, folders: ['/books'], scanAndImport: scan }),
    );
    await settle();
    expect(scan).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });
    expect(scan).toHaveBeenCalledTimes(1);
    expect(scan).toHaveBeenCalledWith(['/books']);
  });

  test('does not scan when disabled', async () => {
    const scan = vi.fn(async () => {});
    renderHook(() =>
      useAutoImportFolders({ enabled: false, folders: ['/books'], scanAndImport: scan }),
    );
    await settle();
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });
    expect(scan).not.toHaveBeenCalled();
  });

  test('does not scan when there are no folders', async () => {
    const scan = vi.fn(async () => {});
    renderHook(() => useAutoImportFolders({ enabled: true, folders: [], scanAndImport: scan }));
    await settle();
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });
    expect(scan).not.toHaveBeenCalled();
  });

  test('re-scans when the app becomes visible again', async () => {
    const scan = vi.fn(async () => {});
    renderHook(() =>
      useAutoImportFolders({ enabled: true, folders: ['/books'], scanAndImport: scan }),
    );
    await settle();
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });
    expect(scan).toHaveBeenCalledTimes(1);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });
    expect(scan).toHaveBeenCalledTimes(2);
  });

  test('coalesces triggers while a scan is in flight', async () => {
    let resolveScan: () => void = () => {};
    const scan = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolveScan = r;
        }),
    );
    renderHook(() =>
      useAutoImportFolders({ enabled: true, folders: ['/books'], scanAndImport: scan }),
    );
    await settle();
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });
    expect(scan).toHaveBeenCalledTimes(1); // pending
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });
    expect(scan).toHaveBeenCalledTimes(1); // still in flight -> no second run
    await act(async () => {
      resolveScan();
      await Promise.resolve();
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });
    expect(scan).toHaveBeenCalledTimes(2);
  });
});
