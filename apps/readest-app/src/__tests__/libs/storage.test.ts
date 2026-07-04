import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/environment', () => ({
  getAPIBaseUrl: () => 'https://api.test',
  isWebAppPlatform: () => false,
}));
vi.mock('@/utils/access', () => ({ getUserID: vi.fn() }));
vi.mock('@/utils/fetch', () => ({ fetchWithAuth: vi.fn() }));
vi.mock('@/utils/transfer', () => ({
  tauriUpload: vi.fn(),
  tauriDownload: vi.fn(),
  webUpload: vi.fn(),
  webDownload: vi.fn(),
}));

import { deleteFile } from '@/libs/storage';
import { getUserID } from '@/utils/access';
import { fetchWithAuth } from '@/utils/fetch';

describe('deleteFile (cloud) — best-effort cleanup (READEST-5)', () => {
  beforeEach(() => vi.clearAllMocks());

  test('resolves without throwing when the delete request fails', async () => {
    vi.mocked(getUserID).mockResolvedValue('user-1');
    vi.mocked(fetchWithAuth).mockRejectedValue(new Error('network down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Callers dispatch this without awaiting; a throw here becomes an unhandled
    // rejection. It must swallow the failure and just log it.
    await expect(deleteFile('books/x.epub')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
  });

  test('resolves without throwing when the user is not authenticated', async () => {
    vi.mocked(getUserID).mockResolvedValue(null);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(deleteFile('books/x.epub')).resolves.toBeUndefined();
    expect(fetchWithAuth).not.toHaveBeenCalled();

    warn.mockRestore();
  });
});
