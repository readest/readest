import { beforeEach, expect, test, vi } from 'vitest';
import { createWebDAVProvider } from '@/services/sync/providers/webdav/WebDAVProvider';
import type { WebDAVSettings } from '@/types/settings';

const { upload, download } = vi.hoisted(() => ({ upload: vi.fn(), download: vi.fn() }));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => true }));
vi.mock('@/utils/transfer', () => ({ tauriUpload: upload, tauriDownload: download }));
const provider = () =>
  createWebDAVProvider({
    serverUrl: 'http://localhost:18084',
    username: 'test',
    password: 'test',
    rootPath: '/Readest',
  } as WebDAVSettings);
beforeEach(() => vi.clearAllMocks());
test.each([
  ['401', 'AUTH_FAILED'],
  ['507', 'UNKNOWN'],
  ['409', 'CONFLICT'],
])('preserves native HTTP %s failures', async (status, code) => {
  upload.mockRejectedValue(`request failed with status code ${status}: server rejected upload`);
  await expect(provider().uploadStream!('/book', '/local')).rejects.toMatchObject({
    code,
    status: Number(status),
    message: expect.stringContaining('server rejected upload'),
  });
});
test('preserves local filesystem errors without calling them network errors', async () => {
  upload.mockRejectedValue('Too many open files (os error 24)');
  await expect(provider().uploadStream!('/book', '/local')).rejects.toMatchObject({
    code: 'UNKNOWN',
    message: 'Too many open files (os error 24)',
  });
});
test('preserves download errors', async () => {
  download.mockRejectedValue('Permission denied (os error 13)');
  await expect(provider().downloadStream!('/book', '/local')).rejects.toThrow('Permission denied');
});
