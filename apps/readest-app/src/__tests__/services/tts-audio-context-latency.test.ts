// Android TTS must not ride the low-latency MMAP output: that path bypasses the
// mixer's effects stage, so on OEM devices the read-aloud came out quieter over
// the speaker than the same voice previewed through an <audio> element. The
// shared context therefore asks for the 'playback' (deep-buffer) hint on
// Android only.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 16; BKQ-AN10 Build/HONORBKQ-AN10; wv) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36';
const WINDOWS_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

type CtorOptions = AudioContextOptions | undefined;

class RecordingContext {
  static instances: RecordingContext[] = [];
  static rejectOptions = false;
  readonly options: CtorOptions;
  state = 'running';
  resume = vi.fn(async () => {});

  constructor(options?: CtorOptions) {
    if (options && RecordingContext.rejectOptions) {
      throw new TypeError('AudioContextOptions not supported');
    }
    this.options = options;
    RecordingContext.instances.push(this);
  }
}

const setUserAgent = (ua: string) => {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
};

const loadModule = async () => {
  vi.resetModules();
  return import('@/services/tts/WebAudioPlayer');
};

beforeEach(() => {
  RecordingContext.instances = [];
  RecordingContext.rejectOptions = false;
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = RecordingContext;
});

afterEach(() => {
  delete (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
});

describe('TTS audio context latency hint', () => {
  it('asks for the deep-buffer path on Android', async () => {
    setUserAgent(ANDROID_UA);
    const { ensureSharedAudioContext } = await loadModule();

    await ensureSharedAudioContext();

    expect(RecordingContext.instances).toHaveLength(1);
    expect(RecordingContext.instances[0]!.options).toEqual({ latencyHint: 'playback' });
  });

  it('keeps the default context elsewhere', async () => {
    setUserAgent(WINDOWS_UA);
    const { ensureSharedAudioContext } = await loadModule();

    await ensureSharedAudioContext();

    expect(RecordingContext.instances).toHaveLength(1);
    expect(RecordingContext.instances[0]!.options).toBeUndefined();
  });

  it('falls back to a default context when the hint is rejected', async () => {
    setUserAgent(ANDROID_UA);
    RecordingContext.rejectOptions = true;
    const { ensureSharedAudioContext } = await loadModule();

    await ensureSharedAudioContext();

    expect(RecordingContext.instances).toHaveLength(1);
    expect(RecordingContext.instances[0]!.options).toBeUndefined();
  });
});
