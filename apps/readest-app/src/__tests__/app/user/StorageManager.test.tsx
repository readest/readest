import { cleanup, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import StorageManager from '@/app/user/components/StorageManager';
import type { ListFilesParams } from '@/libs/storage';

const h = vi.hoisted(() => ({
  listFiles: vi.fn(),
  getStorageStats: vi.fn(),
  purgeFiles: vi.fn(),
  // Stable identity: the real useTranslation memoizes, and StorageManager's
  // loaders depend on it.
  translate: (value: string, params?: Record<string, string | number>) =>
    Object.entries(params ?? {}).reduce(
      (result: string, [key, replacement]) => result.replace(`{{${key}}}`, String(replacement)),
      value,
    ),
}));

vi.mock('@/libs/storage', () => ({
  listFiles: h.listFiles,
  getStorageStats: h.getStorageStats,
  purgeFiles: h.purgeFiles,
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => h.translate,
}));

vi.mock('@/hooks/useLibrary', () => ({
  useLibrary: () => ({ libraryLoaded: true }),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: null, envConfig: {} }),
}));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 } }),
}));

vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: { getState: () => ({ library: [], setLibrary: vi.fn() }) },
}));

const searchParams = () =>
  h.listFiles.mock.calls.map((call) => (call[0] as ListFilesParams).search);

describe('StorageManager search', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    h.listFiles.mockReset();
    h.listFiles.mockResolvedValue({ files: [], totalPages: 1 });
    h.getStorageStats.mockReset();
    h.getStorageStats.mockResolvedValue({
      totalFiles: 0,
      totalSize: 0,
      quota: 100,
      usagePercentage: 0,
    });
  });

  it('does not search while the user is still typing', async () => {
    render(<StorageManager />);
    await waitFor(() => expect(h.listFiles).toHaveBeenCalledTimes(1));

    const input = screen.getByPlaceholderText('Search files...');
    fireEvent.change(input, { target: { value: '中文' } });

    await new Promise((resolve) => setTimeout(resolve, 1200));

    expect(h.listFiles).toHaveBeenCalledTimes(1);
    expect(searchParams()).toEqual([undefined]);
  });

  it('searches when the search button is pressed', async () => {
    render(<StorageManager />);
    await waitFor(() => expect(h.listFiles).toHaveBeenCalledTimes(1));

    const input = screen.getByPlaceholderText('Search files...');
    fireEvent.change(input, { target: { value: ' novel ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(h.listFiles).toHaveBeenCalledTimes(2));
    expect(searchParams()).toEqual([undefined, 'novel']);
  });

  it('ignores Enter while an IME composition is active', async () => {
    render(<StorageManager />);
    await waitFor(() => expect(h.listFiles).toHaveBeenCalledTimes(1));

    const input = screen.getByPlaceholderText('Search files...');
    fireEvent.change(input, { target: { value: 'zhong' } });

    const composing = createEvent.keyDown(input, { key: 'Enter', isComposing: true });
    fireEvent(input, composing);
    expect(composing.defaultPrevented).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(h.listFiles).toHaveBeenCalledTimes(1);

    const committed = createEvent.keyDown(input, { key: 'Enter' });
    fireEvent(input, committed);
    expect(committed.defaultPrevented).toBe(false);
  });

  it('keeps the search box editable while files are loading', async () => {
    let resolveList: (value: { files: never[]; totalPages: number }) => void = () => {};
    h.listFiles.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveList = resolve;
        }),
    );

    render(<StorageManager />);
    const input = screen.getByPlaceholderText('Search files...');
    expect((input as HTMLInputElement).disabled).toBe(false);

    fireEvent.change(input, { target: { value: 'keep typing' } });
    expect((input as HTMLInputElement).value).toBe('keep typing');

    resolveList({ files: [], totalPages: 1 });
    await waitFor(() => expect(h.listFiles).toHaveBeenCalledTimes(1));
  });
});
