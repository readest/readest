import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  appService: { hasSafeAreaInset: true, isIOSApp: true },
  getInsets: vi.fn(),
  updateInsets: vi.fn(),
  updateCornerRadius: vi.fn(),
  setIsIPhoneDuo: vi.fn(),
  recordHidden: vi.fn(),
  storeInsets: { top: 0, right: 0, bottom: 0, left: 0 } as Record<string, number> | null,
  focus: undefined as ((event: { payload: boolean }) => void) | undefined,
  unlisten: vi.fn(),
}));

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: h.appService }) }));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: Object.assign(
    () => ({
      updateSafeAreaInsets: h.updateInsets,
      updateScreenCornerRadius: h.updateCornerRadius,
      setIsIPhoneDuo: h.setIsIPhoneDuo,
      recordStatusBarHiddenInsets: h.recordHidden,
    }),
    { getState: () => ({ safeAreaInsets: h.storeInsets }) },
  ),
}));
vi.mock('@/utils/bridge', () => ({ getSafeAreaInsets: h.getInsets }));
vi.mock('@/utils/misc', () => ({ getOSPlatform: () => 'ios' }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onFocusChanged: (listener: typeof h.focus) => {
      h.focus = listener;
      return Promise.resolve(h.unlisten);
    },
  }),
}));

import { useSafeAreaInsets } from '@/hooks/useSafeAreaInsets';

afterEach(() => {
  cleanup();
  h.storeInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  h.updateInsets.mockClear();
  h.recordHidden.mockClear();
});

it('refreshes CarPlay-only insets when the native phone window gains focus', async () => {
  h.getInsets.mockResolvedValue({ top: 0, right: 0, bottom: 0, left: 0 });
  const { unmount } = renderHook(() => useSafeAreaInsets());
  await waitFor(() => expect(h.getInsets).toHaveBeenCalledOnce());

  const phoneInsets = { top: 59, right: 0, bottom: 34, left: 0 };
  h.getInsets.mockResolvedValue(phoneInsets);
  await act(async () => h.focus?.({ payload: true }));
  expect(h.updateInsets).toHaveBeenLastCalledWith(phoneInsets);

  unmount();
  await waitFor(() => expect(h.unlisten).toHaveBeenCalledOnce());
});

it('reports the rounded bottom corner radius from the native bridge', async () => {
  h.getInsets.mockResolvedValue({ top: 0, right: 0, bottom: 0, left: 0, bottomCornerRadius: 44.6 });
  const { unmount } = renderHook(() => useSafeAreaInsets());
  await waitFor(() => expect(h.updateCornerRadius).toHaveBeenLastCalledWith(45));
  unmount();
});

it('records the insets the Duo reports with the status bar hidden (#6307)', async () => {
  h.getInsets.mockResolvedValue({
    top: 0,
    right: 84,
    bottom: 34,
    left: 0,
    isIPhoneDuo: true,
    statusBarHidden: false,
  });
  const { unmount } = renderHook(() => useSafeAreaInsets());
  await waitFor(() =>
    expect(h.updateInsets).toHaveBeenLastCalledWith({ top: 0, right: 84, bottom: 34, left: 0 }),
  );
  expect(h.recordHidden).not.toHaveBeenCalled();

  h.getInsets.mockResolvedValue({
    top: 0,
    right: 0,
    bottom: 34,
    left: 0,
    isIPhoneDuo: true,
    statusBarHidden: true,
  });
  await act(async () => h.focus?.({ payload: true }));
  expect(h.recordHidden).toHaveBeenLastCalledWith({ top: 0, right: 0, bottom: 34, left: 0 });
  unmount();
});

it('records nothing off the Duo, even with the status bar hidden', async () => {
  h.getInsets.mockResolvedValue({ top: 59, right: 0, bottom: 34, left: 0, statusBarHidden: true });
  const { unmount } = renderHook(() => useSafeAreaInsets());
  await waitFor(() => expect(h.updateInsets).toHaveBeenCalled());
  expect(h.recordHidden).not.toHaveBeenCalled();
  unmount();
});

it('dedupes against the store, so another instance writing it cannot leave it stale', async () => {
  const duo = { top: 0, right: 84, bottom: 34, left: 0 };
  h.getInsets.mockResolvedValue(duo);
  const { unmount } = renderHook(() => useSafeAreaInsets());
  await waitFor(() => expect(h.updateInsets).toHaveBeenLastCalledWith(duo));
  h.updateInsets.mockClear();

  // Store already holds what the bridge reports: nothing to write.
  h.storeInsets = duo;
  await act(async () => h.focus?.({ payload: true }));
  expect(h.updateInsets).not.toHaveBeenCalled();

  // The other useSafeAreaInsets instance stored something else in between.
  h.storeInsets = { top: 0, right: 0, bottom: 34, left: 0 };
  await act(async () => h.focus?.({ payload: true }));
  expect(h.updateInsets).toHaveBeenLastCalledWith(duo);
  unmount();
});
