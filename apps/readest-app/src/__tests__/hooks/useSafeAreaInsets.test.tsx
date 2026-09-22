import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  appService: { hasSafeAreaInset: true, isIOSApp: true },
  getInsets: vi.fn(),
  updateInsets: vi.fn(),
  focus: undefined as ((event: { payload: boolean }) => void) | undefined,
  unlisten: vi.fn(),
}));

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: h.appService }) }));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ updateSafeAreaInsets: h.updateInsets }),
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

afterEach(cleanup);

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
