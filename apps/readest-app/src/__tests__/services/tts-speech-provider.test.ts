import { beforeEach, describe, expect, test, vi } from 'vitest';

// The provider delegates to EdgeSpeechTTS; mock at the lib boundary exactly
// like the edge-tts-client suites so the contract is tested in isolation.
const h = vi.hoisted(() => ({
  createAudioData: vi.fn(),
  create: vi.fn(),
  lastConstructedProtocol: '' as string,
}));

vi.mock('@/libs/edgeTTS', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/libs/edgeTTS')>();
  return {
    ...original,
    EdgeSpeechTTS: class MockEdgeSpeechTTS {
      static voices = [
        { id: 'en-US-AriaNeural', name: 'Aria', lang: 'en-US' },
        { id: 'fr-FR-DeniseNeural', name: 'Denise', lang: 'fr-FR' },
      ];
      constructor(protocol: string) {
        h.lastConstructedProtocol = protocol;
      }
      create = h.create;
      createAudioData = h.createAudioData;
    },
  };
});

import { EdgeSpeechProvider } from '@/services/tts/providers/edge';
import { SpeechSynthesisPermanentError } from '@/services/tts/providers/types';

describe('EdgeSpeechProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.createAudioData.mockResolvedValue({
      data: new ArrayBuffer(4),
      boundaries: [{ offset: 0, duration: 1_000_000, text: 'hello' }],
    });
    h.create.mockResolvedValue(new Response());
  });

  const initializedProvider = async () => {
    const provider = new EdgeSpeechProvider();
    await provider.init();
    return provider;
  };

  test('identifies as edge-tts with a label', async () => {
    const provider = new EdgeSpeechProvider();
    expect(provider.id).toBe('edge-tts');
    expect(provider.label).toBe('Edge TTS');
  });

  test('init probes the transport and reports availability', async () => {
    const provider = new EdgeSpeechProvider();
    await expect(provider.init()).resolves.toBe(true);
    expect(h.lastConstructedProtocol).toBe('wss');

    h.create.mockRejectedValueOnce(new Error('boom'));
    const failing = new EdgeSpeechProvider();
    await expect(failing.init()).resolves.toBe(false);
  });

  test('init accepts an explicit protocol', async () => {
    const provider = new EdgeSpeechProvider();
    await provider.init('https');
    expect(h.lastConstructedProtocol).toBe('https');
  });

  test('synthesize always pins rate to 1.0 in the payload', async () => {
    // The invariant that keeps cached audio rate-independent: the playback
    // rate is a playout concern (WSOLA / AVPlayer), never the provider's.
    const provider = await initializedProvider();
    await provider.synthesize(
      { lang: 'en', text: 'hello world', voice: 'en-US-AriaNeural', pitch: 1.2 },
      new AbortController().signal,
    );
    expect(h.createAudioData).toHaveBeenCalledWith(
      expect.objectContaining({ rate: 1.0, pitch: 1.2, text: 'hello world' }),
    );
  });

  test('synthesize returns audio bytes and boundaries', async () => {
    const provider = await initializedProvider();
    const result = await provider.synthesize(
      { lang: 'en', text: 'hello', voice: 'en-US-AriaNeural', pitch: 1.0 },
      new AbortController().signal,
    );
    expect(result.audio.byteLength).toBe(4);
    expect(result.boundaries).toEqual([{ offset: 0, duration: 1_000_000, text: 'hello' }]);
  });

  test('maps the no-audio failure to SpeechSynthesisPermanentError', async () => {
    // "No audio data received." is permanent for a given sentence; the
    // buffered client must skip it instead of retrying.
    const provider = await initializedProvider();
    h.createAudioData.mockRejectedValue(new Error('No audio data received.'));
    await expect(
      provider.synthesize(
        { lang: 'en', text: 'hello', voice: 'en-US-AriaNeural', pitch: 1.0 },
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(SpeechSynthesisPermanentError);
  });

  test('propagates transient errors unchanged for the client retry path', async () => {
    const provider = await initializedProvider();
    h.createAudioData.mockRejectedValue(new Error('network error'));
    await expect(
      provider.synthesize(
        { lang: 'en', text: 'hello', voice: 'en-US-AriaNeural', pitch: 1.0 },
        new AbortController().signal,
      ),
    ).rejects.toThrow('network error');
  });

  test('exposes the static Edge voice list', async () => {
    const provider = await initializedProvider();
    const voices = await provider.getAllVoices();
    expect(voices.map((v) => v.id)).toEqual(['en-US-AriaNeural', 'fr-FR-DeniseNeural']);
  });
});
