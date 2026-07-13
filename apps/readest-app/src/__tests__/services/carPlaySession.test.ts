import { afterEach, describe, expect, test, vi } from 'vitest';

const invokeMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));

const platform = { os: 'ios', tauri: true };
vi.mock('@/utils/misc', () => ({ getOSPlatform: () => platform.os }));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => platform.tauri }));

import { notifyCarPlayState } from '@/services/tts/carPlaySession';

afterEach(() => {
  invokeMock.mockClear();
  platform.os = 'ios';
  platform.tauri = true;
});

describe('notifyCarPlayState', () => {
  test('invokes the native command on iOS Tauri', async () => {
    await notifyCarPlayState({ active: true, title: 'Alice', author: 'Carroll' });
    expect(invokeMock).toHaveBeenCalledWith('plugin:native-tts|update_carplay_state', {
      payload: { active: true, title: 'Alice', author: 'Carroll' },
    });
  });

  test('no-ops off iOS', async () => {
    platform.os = 'android';
    await notifyCarPlayState({ active: true, title: 'Alice' });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  test('no-ops outside Tauri', async () => {
    platform.tauri = false;
    await notifyCarPlayState({ active: false });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  test('swallows invoke errors', async () => {
    invokeMock.mockRejectedValueOnce(new Error('boom'));
    await expect(notifyCarPlayState({ active: false })).resolves.toBeUndefined();
  });

  test('defaults omitted title/author to empty strings in the payload', async () => {
    await notifyCarPlayState({ active: false });
    expect(invokeMock).toHaveBeenCalledWith('plugin:native-tts|update_carplay_state', {
      payload: { active: false, title: '', author: '' },
    });
  });
});
