import { beforeEach, describe, expect, test, vi } from 'vitest';

import { sweepTTSCaches, touchTTSCacheMeta } from '@/services/tts/providers/cacheSweep';
import type { AppService } from '@/types/system';

const NOW = 1_000_000_000;
const HOUR = 3_600_000;

describe('sweepTTSCaches', () => {
  let files: { path: string; size: number }[];
  let metas: Record<string, number>;
  let deleteDir: ReturnType<typeof vi.fn>;
  let appService: AppService;

  const bookCache = (hash: string, sizeBytes: number, lastUsedAt: number | null) => {
    files.push({ path: `${hash}/cache.db`, size: sizeBytes });
    if (lastUsedAt !== null) {
      files.push({ path: `${hash}/meta.json`, size: 32 });
      metas[hash] = lastUsedAt;
    }
  };

  beforeEach(() => {
    files = [];
    metas = {};
    deleteDir = vi.fn().mockResolvedValue(undefined);
    appService = {
      readDirectory: vi.fn().mockImplementation(async () => files),
      readFile: vi.fn().mockImplementation(async (path: string) => {
        const hash = path.split('/')[1]!;
        if (!(hash in metas)) throw new Error('ENOENT');
        return JSON.stringify({ lastUsedAt: metas[hash] });
      }),
      writeFile: vi.fn().mockResolvedValue(undefined),
      deleteDir,
      createDir: vi.fn().mockResolvedValue(undefined),
    } as unknown as AppService;
  });

  test('does nothing while the total is under budget', async () => {
    bookCache('aaa', 40, NOW - 5 * HOUR);
    bookCache('bbb', 40, NOW - 9 * HOUR);
    // 40 + 40 audio plus two 32-byte meta stamps = 144.
    await sweepTTSCaches(appService, 'aaa', 200, () => NOW);
    expect(deleteDir).not.toHaveBeenCalled();
  });

  test('deletes least recently used book caches until under budget', async () => {
    bookCache('aaa', 60, NOW - 1 * HOUR); // active
    bookCache('bbb', 60, NOW - 9 * HOUR); // oldest
    bookCache('ccc', 60, NOW - 5 * HOUR);
    // Total 276 (three books plus stamps); removing bbb (92) reaches 184.
    await sweepTTSCaches(appService, 'aaa', 200, () => NOW);
    expect(deleteDir).toHaveBeenCalledTimes(1);
    expect(deleteDir).toHaveBeenCalledWith('tts-cache/bbb', 'Cache', true);
  });

  test('never deletes the active book, even when it is the oldest', async () => {
    bookCache('aaa', 80, NOW - 9 * HOUR); // active and oldest
    bookCache('bbb', 80, NOW - 5 * HOUR);
    await sweepTTSCaches(appService, 'aaa', 100, () => NOW);
    expect(deleteDir).toHaveBeenCalledTimes(1);
    expect(deleteDir).toHaveBeenCalledWith('tts-cache/bbb', 'Cache', true);
  });

  test('spares caches used within the grace window (another live session)', async () => {
    bookCache('aaa', 80, NOW - 1 * HOUR);
    bookCache('bbb', 80, NOW - 60_000); // one minute ago: likely open elsewhere
    await sweepTTSCaches(appService, 'aaa', 100, () => NOW);
    expect(deleteDir).not.toHaveBeenCalled();
  });

  test('treats a cache without meta as the oldest candidate', async () => {
    bookCache('aaa', 80, NOW - 1 * HOUR);
    bookCache('bbb', 80, NOW - 9 * HOUR);
    bookCache('ccc', 80, null); // no meta.json
    // Total 304; removing ccc (80) reaches 224.
    await sweepTTSCaches(appService, 'aaa', 250, () => NOW);
    expect(deleteDir).toHaveBeenCalledTimes(1);
    expect(deleteDir).toHaveBeenCalledWith('tts-cache/ccc', 'Cache', true);
  });

  test('handles windows path separators in listings', async () => {
    files.push({ path: 'bbb\\cache.db', size: 200 });
    metas['bbb'] = NOW - 9 * HOUR;
    files.push({ path: 'bbb\\meta.json', size: 32 });
    bookCache('aaa', 80, NOW - 1 * HOUR);
    await sweepTTSCaches(appService, 'aaa', 100, () => NOW);
    expect(deleteDir).toHaveBeenCalledWith('tts-cache/bbb', 'Cache', true);
  });

  test('a listing failure is swallowed', async () => {
    vi.mocked(appService.readDirectory).mockRejectedValue(new Error('no such dir'));
    await expect(sweepTTSCaches(appService, 'aaa', 100, () => NOW)).resolves.toBeUndefined();
  });
});

describe('touchTTSCacheMeta', () => {
  test('writes the last-used stamp and never throws', async () => {
    const writeFile = vi.fn().mockRejectedValue(new Error('disk full'));
    const appService = { writeFile } as unknown as AppService;
    await expect(touchTTSCacheMeta(appService, 'aaa')).resolves.toBeUndefined();
    expect(writeFile).toHaveBeenCalledWith(
      'tts-cache/aaa/meta.json',
      'Cache',
      expect.stringContaining('lastUsedAt'),
    );
  });
});
