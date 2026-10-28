import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  appService: { hasSafeAreaInset: true, isIOSApp: true },
  getInsets: vi.fn(),
  updateInsets: vi.fn(),
  updateCornerRadius: vi.fn(),
  setIsIPhoneDuo: vi.fn(),
  setDuoFold: vi.fn(),
  storeIsIPhoneDuo: false,
  foldListener: null as null | (() => void),
}));

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: h.appService }) }));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: Object.assign(
    () => ({
      updateSafeAreaInsets: h.updateInsets,
      updateScreenCornerRadius: h.updateCornerRadius,
      setIsIPhoneDuo: h.setIsIPhoneDuo,
      setDuoFold: h.setDuoFold,
    }),
    {
      getState: () => ({
        isIPhoneDuo: h.storeIsIPhoneDuo,
        safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      }),
    },
  ),
}));
vi.mock('@/utils/bridge', () => ({ getSafeAreaInsets: h.getInsets }));
vi.mock('@tauri-apps/api/core', () => ({
  addPluginListener: (_plugin: string, event: string, handler: () => void) => {
    if (event === 'duo-fold-changed') h.foldListener = handler;
    return Promise.resolve({ unregister: () => {} });
  },
}));
vi.mock('@/utils/misc', () => ({ getOSPlatform: () => 'ios' }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onFocusChanged: () => Promise.resolve(() => {}),
  }),
}));

import { useSafeAreaInsets } from '@/hooks/useSafeAreaInsets';

afterEach(() => {
  cleanup();
  h.getInsets.mockReset();
  h.setIsIPhoneDuo.mockClear();
  h.setDuoFold.mockClear();
  h.foldListener = null;
  h.storeIsIPhoneDuo = false;
});

const zero = { top: 0, right: 0, bottom: 0, left: 0 };

describe('useSafeAreaInsets iPhone Duo flag', () => {
  it('records the native isIPhoneDuo flag', async () => {
    h.getInsets.mockResolvedValue({ ...zero, right: 84, isIPhoneDuo: true });
    renderHook(() => useSafeAreaInsets());
    await waitFor(() => expect(h.setIsIPhoneDuo).toHaveBeenLastCalledWith(true));
  });

  it('is false when the bridge does not report it', async () => {
    h.getInsets.mockResolvedValue(zero);
    renderHook(() => useSafeAreaInsets());
    await waitFor(() => expect(h.setIsIPhoneDuo).toHaveBeenLastCalledWith(false));
  });

  it('refetches on resize only on the Duo', async () => {
    h.getInsets.mockResolvedValue(zero);
    renderHook(() => useSafeAreaInsets());
    await waitFor(() => expect(h.getInsets).toHaveBeenCalledTimes(1));

    window.dispatchEvent(new Event('resize'));
    await new Promise((r) => setTimeout(r, 0));
    expect(h.getInsets).toHaveBeenCalledTimes(1);

    h.storeIsIPhoneDuo = true;
    window.dispatchEvent(new Event('resize'));
    await waitFor(() => expect(h.getInsets).toHaveBeenCalledTimes(2));
  });
});

describe('useSafeAreaInsets iPhone Duo fold', () => {
  const fold = {
    status: 'partial',
    regionActive: true,
    region: { x: 455, y: 0, width: 40, height: 669 },
  };

  it('records the fold on the Duo and clears it elsewhere', async () => {
    h.getInsets.mockResolvedValue({ ...zero, isIPhoneDuo: true, fold });
    renderHook(() => useSafeAreaInsets());
    await waitFor(() => expect(h.setDuoFold).toHaveBeenLastCalledWith(fold));
    cleanup();

    h.getInsets.mockResolvedValue({ ...zero, fold });
    renderHook(() => useSafeAreaInsets());
    await waitFor(() => expect(h.setDuoFold).toHaveBeenLastCalledWith(null));
  });

  it('refetches on a hinge change and again once UIKit settles the region', async () => {
    h.getInsets.mockResolvedValue({ ...zero, isIPhoneDuo: true, fold });
    renderHook(() => useSafeAreaInsets());
    await waitFor(() => expect(h.foldListener).not.toBeNull());
    await waitFor(() => expect(h.getInsets).toHaveBeenCalledTimes(1));

    vi.useFakeTimers();
    try {
      h.foldListener!();
      expect(h.getInsets).toHaveBeenCalledTimes(2);
      vi.advanceTimersByTime(300);
      expect(h.getInsets).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
