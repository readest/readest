import { describe, expect, test, vi } from 'vitest';
import { deleteFont } from '@/services/fontService';
import type { FileSystem } from '@/types/system';

describe('deleteFont', () => {
  test('removes the bundle dir of a cloud-only font that was never downloaded', async () => {
    const fs = {
      exists: vi.fn(async () => false),
      removeFile: vi.fn(async () => {
        throw new Error('No such file or directory');
      }),
      removeDir: vi.fn(async () => {}),
    } as unknown as FileSystem;

    await deleteFont(fs, {
      id: 'bundle',
      name: 'Inter Regular',
      bundleDir: 'bundle',
      path: 'bundle/Inter-Regular.ttf',
      unavailable: true,
    });

    expect(fs.removeFile).not.toHaveBeenCalled();
    expect(fs.removeDir).toHaveBeenCalledWith('bundle', 'Fonts', true);
  });
});
