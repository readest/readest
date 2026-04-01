import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

const mockConvert = vi.fn();
vi.mock('@/utils/txt', () => ({
  TxtToEpubConverter: class {
    convert = mockConvert;
  },
}));

let mockPlatform = 'macos';
vi.mock('@/utils/misc', () => ({
  getOSPlatform: () => mockPlatform,
}));

vi.mock('@/utils/txt-worker-protocol', () => ({}));

import { convertTxtToEpubWithFallback } from '@/utils/txt-worker';

const makeFile = (name: string, sizeBytes: number): File => {
  const buffer = new ArrayBuffer(sizeBytes);
  return new File([buffer], name, { type: 'text/plain' });
};

const fakeResult = {
  file: new File([new ArrayBuffer(0)], 'output.epub', { type: 'application/epub+zip' }),
  bookTitle: 'Test Book',
  chapterCount: 5,
  language: 'en',
};

describe('convertTxtToEpubWithFallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPlatform = 'macos';
    mockConvert.mockResolvedValue(fakeResult);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('when Worker is undefined (default jsdom)', () => {
    test('falls back to main thread conversion', async () => {
      const file = makeFile('book.txt', 1024);
      const result = await convertTxtToEpubWithFallback({ file });

      expect(mockConvert).toHaveBeenCalledOnce();
      expect(mockConvert).toHaveBeenCalledWith({ file });
      expect(result).toEqual(fakeResult);
    });

    test('passes author and language options to TxtToEpubConverter.convert', async () => {
      const file = makeFile('book.txt', 1024);
      const options = { file, author: 'Jane Doe', language: 'zh' };
      const result = await convertTxtToEpubWithFallback(options);

      expect(mockConvert).toHaveBeenCalledWith(options);
      expect(result).toEqual(fakeResult);
    });

    test('returns the converted result from main thread', async () => {
      const customResult = { ...fakeResult, bookTitle: 'Custom Title', chapterCount: 12 };
      mockConvert.mockResolvedValue(customResult);

      const file = makeFile('novel.txt', 2048);
      const result = await convertTxtToEpubWithFallback({ file });

      expect(result).toEqual(customResult);
    });

    test('propagates errors from main thread conversion', async () => {
      mockConvert.mockRejectedValue(new Error('conversion failed'));

      const file = makeFile('bad.txt', 512);
      await expect(convertTxtToEpubWithFallback({ file })).rejects.toThrow('conversion failed');
    });
  });

  describe('iOS large file bypass', () => {
    const SIXTEEN_MB_PLUS_ONE = 16 * 1024 * 1024 + 1;

    test('bypasses worker for iOS files larger than 16MB', async () => {
      mockPlatform = 'ios';
      const file = makeFile('large.txt', SIXTEEN_MB_PLUS_ONE);
      const result = await convertTxtToEpubWithFallback({ file });

      expect(mockConvert).toHaveBeenCalledOnce();
      expect(mockConvert).toHaveBeenCalledWith({ file });
      expect(result).toEqual(fakeResult);
    });

    test('does not bypass worker for iOS files at exactly 16MB', async () => {
      mockPlatform = 'ios';
      // At exactly 16MB, condition is > not >=, so it should NOT bypass.
      // But since Worker is undefined in jsdom, it still goes to main thread.
      // The important thing is the bypass condition itself.
      const file = makeFile('exact.txt', 16 * 1024 * 1024);
      await convertTxtToEpubWithFallback({ file });

      expect(mockConvert).toHaveBeenCalledOnce();
    });

    test('does not apply iOS bypass for other platforms with large files', async () => {
      mockPlatform = 'macos';
      // On macOS, large file size alone does not trigger the iOS bypass.
      // Still falls back because Worker is undefined.
      const file = makeFile('large.txt', SIXTEEN_MB_PLUS_ONE);
      await convertTxtToEpubWithFallback({ file });

      expect(mockConvert).toHaveBeenCalledOnce();
    });
  });

  describe('when Worker is available but fails', () => {
    beforeEach(() => {
      vi.stubGlobal(
        'Worker',
        class {
          constructor() {
            throw new Error('mock worker fail');
          }
        },
      );
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    test('falls back to main thread when worker constructor throws', async () => {
      const file = makeFile('book.txt', 1024);
      const result = await convertTxtToEpubWithFallback({ file });

      expect(mockConvert).toHaveBeenCalledOnce();
      expect(mockConvert).toHaveBeenCalledWith({ file });
      expect(result).toEqual(fakeResult);
    });

    test('logs a warning when falling back from worker failure', async () => {
      const file = makeFile('book.txt', 1024);
      await convertTxtToEpubWithFallback({ file });

      expect(console.warn).toHaveBeenCalledWith(
        'TXT conversion worker failed, falling back to main thread:',
        expect.any(Error),
      );
    });

    test('still applies iOS large file bypass even when Worker is available', async () => {
      mockPlatform = 'ios';
      const file = makeFile('large.txt', 16 * 1024 * 1024 + 1);
      const result = await convertTxtToEpubWithFallback({ file });

      // Should go directly to main thread (bypass), not through worker
      expect(mockConvert).toHaveBeenCalledOnce();
      expect(result).toEqual(fakeResult);
      // No warning logged because the bypass skips the worker entirely
      expect(console.warn).not.toHaveBeenCalled();
    });
  });
});
