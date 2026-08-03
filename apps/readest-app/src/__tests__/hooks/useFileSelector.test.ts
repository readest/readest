import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { AppService } from '@/types/system';

const basenameMock = vi.fn(async (path: string) => path.split('/').pop() || path);

vi.mock('@tauri-apps/api/path', () => ({
  basename: (path: string) => basenameMock(path),
}));

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => true,
}));

const envMock: Record<string, string> = {};
const invokeMock = vi.fn(async (cmd: string, args?: { name?: string }) => {
  if (cmd === 'get_environment_variable') return envMock[args?.name ?? ''] ?? '';
  return '';
});

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: { name?: string }) => invokeMock(cmd, args),
}));

import { useFileSelector } from '@/hooks/useFileSelector';
import { eventDispatcher } from '@/utils/event';

const _ = (key: string) => key;

const makeAppService = (
  platform: 'ios' | 'android' | 'linux',
  picked: string[],
): { appService: AppService; selectFiles: ReturnType<typeof vi.fn> } => {
  const selectFiles = vi.fn(async () => picked);
  const appService = {
    isIOSApp: platform === 'ios',
    isAndroidApp: platform === 'android',
    isLinuxApp: platform === 'linux',
    selectFiles,
  } as unknown as AppService;
  return { appService, selectFiles };
};

beforeEach(() => {
  basenameMock.mockClear();
  invokeMock.mockClear();
  for (const key of Object.keys(envMock)) delete envMock[key];
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

describe('useFileSelector under gamescope (SteamOS Gaming Mode, #3049)', () => {
  test('Linux in a gamescope session: explains that the file dialog cannot appear', async () => {
    envMock['GAMESCOPE_WAYLAND_DISPLAY'] = 'gamescope-0';
    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch').mockResolvedValue();
    const { appService } = makeAppService('linux', []);
    const { selectFiles: select } = useFileSelector(appService, _);

    const result = await select({ type: 'books', multiple: true });

    // The gamescope session runs no XDG portal backend, so the FileChooser
    // dialog never opens and the empty result looks exactly like a user
    // cancel. Without a toast the import button is a silent no-op.
    expect(dispatchSpy).toHaveBeenCalledWith(
      'toast',
      expect.objectContaining({
        type: 'info',
        message: expect.stringContaining('Gaming Mode'),
      }),
    );
    expect(result.files).toHaveLength(0);
    dispatchSpy.mockRestore();
  });

  test('Linux on a regular desktop: no toast, dialog result is untouched', async () => {
    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch').mockResolvedValue();
    const { appService } = makeAppService('linux', ['/home/user/books/book.epub']);
    const { selectFiles: select } = useFileSelector(appService, _);

    const result = await select({ type: 'books', multiple: true });

    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(result.files).toHaveLength(1);
    dispatchSpy.mockRestore();
  });

  test('non-Linux platforms never probe the environment', async () => {
    const { appService } = makeAppService('android', ['content://media/external/file/42']);
    const { selectFiles: select } = useFileSelector(appService, _);

    await select({ type: 'books', multiple: true });

    expect(invokeMock).not.toHaveBeenCalled();
  });
});
