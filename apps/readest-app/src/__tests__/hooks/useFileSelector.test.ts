import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { AppService } from '@/types/system';

const basenameMock = vi.fn(async (path: string) => path.split('/').pop() || path);

vi.mock('@tauri-apps/api/path', () => ({
  basename: (path: string) => basenameMock(path),
}));

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => true,
}));

import { useFileSelector } from '@/hooks/useFileSelector';

const _ = (key: string) => key;

const makeAppService = (
  platform: 'ios' | 'android',
  picked: string[],
): { appService: AppService; selectFiles: ReturnType<typeof vi.fn> } => {
  const selectFiles = vi.fn(async () => picked);
  const appService = {
    isIOSApp: platform === 'ios',
    isAndroidApp: platform === 'android',
    selectFiles,
  } as unknown as AppService;
  return { appService, selectFiles };
};

beforeEach(() => {
  basenameMock.mockClear();
});

describe('useFileSelector cover selection', () => {
  test('iOS: asks the native picker for the image extensions so the photo picker opens', async () => {
    const { appService, selectFiles } = makeAppService('ios', [
      'file:///private/var/mobile/Containers/Data/Application/ABC/Library/Caches/photo.jpg',
    ]);
    const { selectFiles: select } = useFileSelector(appService, _);

    await select({ type: 'covers', multiple: false });

    // The iOS branch currently passes `[]` (unfiltered), which makes the Tauri
    // dialog plugin fall back to the Files document picker instead of the
    // Photos (PHPicker) UI.
    expect(selectFiles).toHaveBeenCalledWith(expect.any(String), ['png', 'jpg', 'jpeg', 'gif']);
  });

  test('iOS: keeps a picked HEIC photo instead of silently dropping it', async () => {
    const { appService } = makeAppService('ios', [
      'file:///private/var/mobile/Containers/Data/Application/ABC/Library/Caches/IMG_0001.heic',
    ]);
    const { selectFiles: select } = useFileSelector(appService, _);

    const result = await select({ type: 'covers', multiple: false });

    // A HEIC photo is the iPhone camera default. Dropping it here makes the
    // "Change cover image" button a silent no-op.
    expect(result.files).toHaveLength(1);
  });

  test('Android: leaves the MIME-filtered picker result untouched', async () => {
    const { appService, selectFiles } = makeAppService('android', [
      'content://media/external/images/media/42',
    ]);
    const { selectFiles: select } = useFileSelector(appService, _);

    const result = await select({ type: 'covers', multiple: false });

    expect(selectFiles).toHaveBeenCalledWith(expect.any(String), ['png', 'jpg', 'jpeg', 'gif']);
    expect(result.files).toHaveLength(1);
  });
});
