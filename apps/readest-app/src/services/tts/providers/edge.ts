// Edge (Microsoft) speech as a SpeechProvider. Pure re-homing: the WS/HTTP
// transport, LRU + inflight caches, and voice list all stay in
// EdgeSpeechTTS (@/libs/edgeTTS); this adapter owns the contract-level
// concerns — the rate-1.0 invariant and permanent-error classification.

import { EDGE_TTS_PROTOCOL, EdgeSpeechTTS } from '@/libs/edgeTTS';
import type { TTSVoice } from '../types';
import {
  SpeechProvider,
  SpeechSynthesisPermanentError,
  SpeechSynthesisRequest,
  SpeechSynthesisResult,
} from './types';

export class EdgeSpeechProvider implements SpeechProvider {
  readonly id = 'edge-tts';
  readonly label = 'Edge TTS';
  readonly fallbackVoiceId = 'en-US-AriaNeural';
  readonly cacheable = true;

  #tts: EdgeSpeechTTS | null = null;

  // The wss transport is free but intermittently blocked; the https fallback
  // goes through the authenticated proxy route. The Edge client owns the
  // fallback policy (auth state lives there); the provider just takes the
  // protocol to probe with.
  async init(protocol: EDGE_TTS_PROTOCOL = 'wss'): Promise<boolean> {
    this.#tts = new EdgeSpeechTTS(protocol);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      // Initialization gates every engine and the player controls. In
      // particular, a native WebSocket can hang before its audio timer starts.
      return await Promise.race([
        this.#tts
          .create({
            lang: 'en',
            text: 'test',
            voice: 'en-US-AriaNeural',
            rate: 1.0,
            pitch: 1.0,
          })
          .then(() => true),
        new Promise<false>((resolve) => {
          timeout = setTimeout(() => resolve(false), 5000);
        }),
      ]);
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  async getAllVoices(): Promise<TTSVoice[]> {
    return EdgeSpeechTTS.voices;
  }

  async synthesize(
    req: SpeechSynthesisRequest,
    _signal: AbortSignal,
  ): Promise<SpeechSynthesisResult> {
    const tts = this.#tts;
    if (!tts) throw new Error('EdgeSpeechProvider not initialized');
    try {
      // Rate pinned to 1.0: keeps the audio cache rate-independent; the
      // playback rate is applied at playout.
      const { data, boundaries } = await tts.createAudioData({
        lang: req.lang,
        text: req.text,
        voice: req.voice,
        rate: 1.0,
        pitch: req.pitch,
      });
      return { audio: data, boundaries };
    } catch (err) {
      // Permanent for this sentence: Edge answered without audio frames.
      if (err instanceof Error && err.message === 'No audio data received.') {
        throw new SpeechSynthesisPermanentError(err.message, { cause: err });
      }
      throw err;
    }
  }

  pickDefaultVoice(voices: TTSVoice[]): string | undefined {
    // Avoid AnaNeural (a child voice) as an accidental English default.
    const first = voices[0];
    if (first?.id === 'en-US-AnaNeural') return 'en-US-AriaNeural';
    return first?.id;
  }
}
