import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/utils/misc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/misc')>()),
  getOSPlatform: vi.fn(),
}));
vi.mock('@/services/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/environment')>()),
  isTauriAppPlatform: vi.fn(),
}));

import { unblockAudio, releaseUnblockAudio } from '@/services/tts/ttsMediaBridge';
import { isTauriAppPlatform } from '@/services/environment';
import { getOSPlatform } from '@/utils/misc';

describe('unblockAudio', () => {
  beforeEach(() => {
    releaseUnblockAudio();
    vi.clearAllMocks();
  });

  test('does not create the keep-alive element on iOS Tauri', () => {
    // iOS plays TTS natively (app-process AVPlayer / AVSpeechSynthesizer);
    // the native media session owns now-playing. A playing HTMLMediaElement
    // flips WebKit into registering its own now-playing client — a bare
    // "localhost" card with dead buttons that fights the native session.
    vi.mocked(getOSPlatform).mockReturnValue('ios');
    vi.mocked(isTauriAppPlatform).mockReturnValue(true);
    const spy = vi.spyOn(document, 'createElement');
    unblockAudio();
    expect(spy).not.toHaveBeenCalledWith('audio');
    spy.mockRestore();
  });

  test('creates the keep-alive element on other platforms', () => {
    // Desktop Chromium only surfaces hardware media keys while an
    // HTMLMediaElement is playing; iOS Safari (web) still needs it against
    // the mute switch.
    vi.mocked(getOSPlatform).mockReturnValue('macos');
    vi.mocked(isTauriAppPlatform).mockReturnValue(false);
    const spy = vi.spyOn(document, 'createElement');
    unblockAudio();
    expect(spy).toHaveBeenCalledWith('audio');
    spy.mockRestore();
    releaseUnblockAudio();
  });
});
