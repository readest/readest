import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

type SingleInstanceHandler = (event: { payload: { args: string[]; cwd: string } }) => unknown;

let currentLabel = 'reader-0';
let windowLabels: string[] = [];
let singleInstanceHandler: SingleInstanceHandler | null = null;
const ensureMainLibraryWindow = vi.fn();

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    label: currentLabel,
    listen: vi.fn(async (event: string, handler: SingleInstanceHandler) => {
      if (event === 'single-instance') singleInstanceHandler = handler;
      return () => {};
    }),
  }),
  getAllWindows: async () => windowLabels.map((label) => ({ label })),
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { hasWindow: true } }),
}));
vi.mock('@/utils/nav', () => ({
  ensureMainLibraryWindow: (...args: unknown[]) => ensureMainLibraryWindow(...args),
}));

import { useRestoreLibraryOnRelaunch } from '@/hooks/useRestoreLibraryOnRelaunch';

const relaunch = async (args: string[]) => {
  renderHook(() => useRestoreLibraryOnRelaunch());
  await vi.waitFor(() => expect(singleInstanceHandler).not.toBeNull());
  await singleInstanceHandler!({ payload: { args, cwd: '/' } });
};

beforeEach(() => {
  currentLabel = 'reader-0';
  windowLabels = [];
  singleInstanceHandler = null;
  ensureMainLibraryWindow.mockReset();
});

describe('useRestoreLibraryOnRelaunch', () => {
  it('reopens the library when the app is relaunched with only reader windows open', async () => {
    windowLabels = ['reader-1', 'reader-0'];
    await relaunch(['/usr/bin/readest']);
    expect(ensureMainLibraryWindow).toHaveBeenCalledWith({ hasWindow: true });
  });

  it('leaves the library alone when the main window is still open', async () => {
    windowLabels = ['main', 'reader-0'];
    await relaunch(['/usr/bin/readest']);
    expect(ensureMainLibraryWindow).not.toHaveBeenCalled();
  });

  it('lets only the first reader window reopen the library', async () => {
    currentLabel = 'reader-1';
    windowLabels = ['reader-0', 'reader-1'];
    await relaunch(['/usr/bin/readest']);
    expect(ensureMainLibraryWindow).not.toHaveBeenCalled();
  });

  it('leaves relaunches that carry a file or link to the open-with handlers', async () => {
    windowLabels = ['reader-0'];
    await relaunch(['/usr/bin/readest', '/home/user/book.epub']);
    expect(ensureMainLibraryWindow).not.toHaveBeenCalled();
  });
});
