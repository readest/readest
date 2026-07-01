import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  addPluginListener: vi.fn().mockResolvedValue({ unregister: vi.fn() }),
}));

// Avoid pulling in the heavy TTSController module graph (foliate-js, etc.) — the
// native client only references it as a type.
vi.mock('@/services/tts/TTSController', () => ({ TTSController: class {} }));

import { NativeTTSClient } from '@/services/tts/NativeTTSClient';
import { invoke } from '@tauri-apps/api/core';

describe('NativeTTSClient.stop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('resolves promptly when the native stop resolves', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const client = new NativeTTSClient();

    await client.stop();

    expect(invoke).toHaveBeenCalledWith('plugin:native-tts|stop');
  });

  test('still resolves (bounded) when the native stop never resolves', async () => {
    // Regression for #4676: a hung native stop must not hang teardown
    // (controller.stop / shutdown), which would leave the TTS icon stuck.
    vi.mocked(invoke).mockReturnValue(new Promise(() => {}));
    const client = new NativeTTSClient();

    let settled = false;
    const p = client.stop().then(() => {
      settled = true;
    });

    // Pending until the timeout fires.
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1500);
    await p;
    expect(settled).toBe(true);
  });
});
