import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import StorageManager from '@/app/user/components/StorageManager';

// A book's synced TTS packs are listed under the book with its book_hash.
// They must not stand in for the book in Manage Storage, and deleting only
// them must leave the book marked as uploaded.

const h = vi.hoisted(() => ({
  listFiles: vi.fn(),
  getStorageStats: vi.fn(),
  purgeFiles: vi.fn(),
  book: { hash: 'h', title: 'T', uploadedAt: 1 as number | null, updatedAt: 0 },
  translate: (value: string, params?: Record<string, string | number>) =>
    Object.entries(params ?? {}).reduce(
      (result: string, [key, replacement]) => result.replace(`{{${key}}}`, String(replacement)),
      value,
    ),
  appService: { saveLibraryBooks: vi.fn() },
}));

vi.mock('@/libs/storage', () => ({
  listFiles: h.listFiles,
  getStorageStats: h.getStorageStats,
  purgeFiles: h.purgeFiles,
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => h.translate }));
vi.mock('@/hooks/useLibrary', () => ({ useLibrary: () => ({ libraryLoaded: true }) }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: h.appService, envConfig: {} }),
}));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 } }),
}));
vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: { getState: () => ({ library: [h.book], setLibrary: vi.fn() }) },
}));

const row = (file_key: string, created_at: string) => ({
  file_key,
  file_size: 10,
  book_hash: 'h',
  replica_kind: null,
  replica_id: null,
  created_at,
  updated_at: null,
});

beforeEach(() => {
  h.book.uploadedAt = 1;
  // Newest first, as the default sort returns them: the packs came later.
  h.listFiles.mockReset().mockResolvedValue({
    files: [
      row('u1/Readest/Books/h/tts/3-ab12.mp3', '2026-10-30T00:00:00Z'),
      row('u1/Readest/Books/h/tts/3-ab12.json', '2026-10-30T00:00:00Z'),
      row('u1/Readest/Books/h/Title.epub', '2026-10-01T00:00:00Z'),
    ],
    totalPages: 1,
  });
  h.getStorageStats.mockReset().mockResolvedValue({
    totalFiles: 3,
    totalSize: 30,
    quota: 100,
    usagePercentage: 30,
  });
  h.purgeFiles.mockReset().mockResolvedValue({ deletedCount: 1, failedCount: 0 });
});
afterEach(cleanup);

describe('StorageManager with synced book data', () => {
  it('labels the book by its book file, not a TTS pack', async () => {
    render(<StorageManager />);
    await waitFor(() => expect(screen.getByText('Title.epub')).toBeTruthy());
  });

  it('deleting only TTS packs keeps the book marked as uploaded', async () => {
    render(<StorageManager />);
    await waitFor(() => expect(screen.getByText('+')).toBeTruthy());
    fireEvent.click(screen.getByText('+'));
    const mp3 = screen.getAllByText('3-ab12.mp3').at(-1)!.closest('tr')!;
    fireEvent.click(mp3.querySelector('input[type="checkbox"]')!);
    fireEvent.click(screen.getByText('Delete Selected'));
    fireEvent.click(screen.getByText('Confirm'));
    await waitFor(() =>
      expect(h.purgeFiles).toHaveBeenCalledWith(['u1/Readest/Books/h/tts/3-ab12.mp3'], true),
    );
    expect(h.book.uploadedAt).toBe(1);
  });
});
