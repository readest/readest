// @vitest-environment happy-dom
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
import type { KosyncEngineConfig } from '@/app/reader/hooks/useKOSync';

const mocks = vi.hoisted(() => ({
  getBook: vi.fn(),
  updateProgress: vi.fn(),
  deleteBook: vi.fn(async () => undefined),
}));

vi.mock('@/services/grimmory/bookMatch', () => ({
  resolveGrimmoryBook: vi.fn(async () => ({
    bookId: 2,
    bookFileId: 2,
    bookType: 'EPUB',
    isPrimary: true,
    statusPushedAt: 0,
  })),
}));
vi.mock('@/services/grimmory/GrimmoryClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/grimmory/GrimmoryClient')>()),
  GrimmoryClient: vi.fn(function () {
    return { getBook: mocks.getBook, updateProgress: mocks.updateProgress };
  }),
}));
vi.mock('@/services/grimmory/GrimmorySyncStore', () => ({
  GrimmorySyncStore: vi.fn(function () {
    return { deleteBook: mocks.deleteBook };
  }),
}));

import { GrimmoryRequestError } from '@/services/grimmory/GrimmoryClient';
import { grimmoryProgressProvider } from '@/app/reader/hooks/grimmoryProgressProvider';

const config = {
  serverUrl: 'https://grimmory.example',
  username: 'reader',
  password: 'secret',
} as KosyncEngineConfig;
const book = { hash: 'abc', format: 'EPUB' } as Book;

describe('grimmoryProgressProvider', () => {
  beforeEach(() => vi.clearAllMocks());

  test('forgets the stored match when the book is gone from the server (404)', async () => {
    const client = grimmoryProgressProvider.createClient!(config, {} as AppService);
    mocks.getBook.mockRejectedValueOnce(new GrimmoryRequestError(404, 'gone'));
    expect(await client.getProgress(book)).toBeNull();
    mocks.updateProgress.mockRejectedValueOnce(new GrimmoryRequestError(404, 'gone'));
    expect(await client.updateProgress(book, 'epubcfi(/6/2!/4/2)', 0.1)).toBe(false);
    expect(mocks.deleteBook).toHaveBeenCalledTimes(2);
    expect(mocks.deleteBook).toHaveBeenCalledWith(expect.any(String), 'abc');
  });

  test('says why a read or a write failed, and clears it after one that works', async () => {
    const client = grimmoryProgressProvider.createClient!(config, {} as AppService);
    mocks.getBook.mockRejectedValueOnce(new GrimmoryRequestError(503, 'down'));
    await client.getProgress(book);
    expect(client.lastError).toBe('down');

    mocks.updateProgress.mockResolvedValueOnce(undefined);
    await client.updateProgress(book, 'epubcfi(/6/2!/4/2)', 0.1);
    expect(client.lastError).toBeNull();

    mocks.updateProgress.mockRejectedValueOnce(new GrimmoryRequestError(500, 'boom'));
    await client.updateProgress(book, 'epubcfi(/6/2!/4/2)', 0.1);
    expect(client.lastError).toBe('boom');
  });

  test('keeps the match on other errors', async () => {
    const client = grimmoryProgressProvider.createClient!(config, {} as AppService);
    mocks.getBook.mockRejectedValueOnce(new GrimmoryRequestError(503, 'down'));
    expect(await client.getProgress(book)).toBeNull();
    expect(mocks.deleteBook).not.toHaveBeenCalled();
  });
});
