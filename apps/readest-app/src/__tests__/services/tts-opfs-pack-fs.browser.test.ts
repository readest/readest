import { beforeEach, describe, expect, test } from 'vitest';

import { createOpfsPackFs } from '@/services/tts/providers/opfsPackFs';

const DIR = 'tts-cache/test-book/packs';

const bytes = (...values: number[]) => new Uint8Array(values);

describe('createOpfsPackFs (real OPFS)', () => {
  beforeEach(async () => {
    // Isolate runs: drop the test book's cache dir if a previous test left it.
    const root = await navigator.storage.getDirectory();
    try {
      const parent = await root.getDirectoryHandle('tts-cache');
      await parent.removeEntry('test-book', { recursive: true });
    } catch {
      // First run: nothing to clean.
    }
  });

  test('write, rename, list, and range reads round-trip', async () => {
    const fs = await createOpfsPackFs(DIR);
    expect(fs).toBeDefined();

    await fs!.write('tmp-1.mp3', bytes(1, 2, 3, 4, 5, 6));
    await fs!.rename('tmp-1.mp3', '1-abcd.mp3');

    const names = await fs!.list();
    expect(names).toEqual(['1-abcd.mp3']);

    const range = await fs!.readRange('1-abcd.mp3', 2, 3);
    expect([...new Uint8Array(range)]).toEqual([3, 4, 5]);
  });

  test('remove deletes files and readRange on missing files throws', async () => {
    const fs = await createOpfsPackFs(DIR);
    await fs!.write('x.mp3', bytes(9, 9));
    await fs!.remove('x.mp3');
    expect(await fs!.list()).toEqual([]);
    await expect(fs!.readRange('x.mp3', 0, 1)).rejects.toThrow();
  });

  test('a short file fails the range read instead of returning truncated audio', async () => {
    const fs = await createOpfsPackFs(DIR);
    await fs!.write('short.mp3', bytes(1, 2));
    await expect(fs!.readRange('short.mp3', 0, 10)).rejects.toThrow(/short pack read/);
  });
});
