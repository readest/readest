// Embedded, offline Piper voices as a SpeechProvider (Android only for now
// — see tauri-plugin-piper-tts). Unlike Edge, there is no word-boundary
// stream: sherpa-onnx's OfflineTts returns one finished WAV buffer per call,
// so `boundaries` is always empty and the controller falls back to
// sentence-level highlighting (see TTSCapabilities.wordBoundaries).

import { invoke } from '@tauri-apps/api/core';
import { isTauriAppPlatform } from '@/services/environment';
import type { TTSVoice } from '../types';
import { PIPER_VOICE_CATALOG, findPiperVoice } from './piperVoices';
import {
  SpeechProvider,
  SpeechSynthesisPermanentError,
  SpeechSynthesisRequest,
  SpeechSynthesisResult,
} from './types';

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export class PiperSpeechProvider implements SpeechProvider {
  readonly id = 'piper-tts';
  readonly label = 'Piper TTS (offline)';
  readonly cacheable = true;

  #available = false;
  #voiceStatus = new Map<string, boolean>(); // id -> downloaded

  async init(): Promise<boolean> {
    // Piper is currently only wired up on Android (see plugin README); on
    // every other platform this provider reports itself unavailable so it
    // simply does not appear in the voice picker, same as NativeTTSClient
    // does for desktop.
    if (!isTauriAppPlatform()) {
      this.#available = false;
      return false;
    }
    try {
      const res = await invoke<{ voices: { id: string; downloaded: boolean }[] }>(
        'plugin:piper-tts|list_voices',
        { catalog: PIPER_VOICE_CATALOG.map(toWireDescriptor) },
      );
      res.voices.forEach((v) => this.#voiceStatus.set(v.id, v.downloaded));
      this.#available = true;
      return true;
    } catch {
      // Plugin not registered on this platform/build (e.g. desktop, or an
      // Android build made without vendoring sherpa-onnx) — degrade quietly.
      this.#available = false;
      return false;
    }
  }

  async getAllVoices(): Promise<TTSVoice[]> {
    if (!this.#available) return [];
    // Only downloaded voices are offered for selection; the download UI
    // (useTTSDownloads-style panel, see piperVoiceManager.ts) is what moves
    // a voice from "in catalog" to "in this list".
    return PIPER_VOICE_CATALOG.filter((v) => this.#voiceStatus.get(v.id)).map((v) => ({
      id: v.id,
      name: v.name,
      lang: v.lang,
    }));
  }

  async synthesize(
    req: SpeechSynthesisRequest,
    _signal: AbortSignal,
  ): Promise<SpeechSynthesisResult> {
    const descriptor = findPiperVoice(req.voice);
    if (!descriptor) {
      throw new SpeechSynthesisPermanentError(`Unknown Piper voice: ${req.voice}`);
    }
    if (!this.#voiceStatus.get(req.voice)) {
      throw new SpeechSynthesisPermanentError(`Piper voice not downloaded: ${req.voice}`);
    }
    try {
      const res = await invoke<{ audioBase64: string; sampleRate: number; numSamples: number }>(
        'plugin:piper-tts|synthesize',
        { id: req.voice, text: req.text, speakerId: 0, speed: 1.0 },
      );
      return { audio: base64ToArrayBuffer(res.audioBase64), boundaries: [] };
    } catch (err) {
      throw new SpeechSynthesisPermanentError(
        err instanceof Error ? err.message : 'Piper synthesis failed',
        { cause: err },
      );
    }
  }

  pickDefaultVoice(voices: TTSVoice[]): string | undefined {
    return voices[0]?.id;
  }

  // Read-only status check for UI (e.g. PiperVoicesSection): whether a
  // catalog voice's files are present on disk right now.
  isDownloaded(id: string): boolean {
    return this.#voiceStatus.get(id) ?? false;
  }

  get isAvailable(): boolean {
    return this.#available;
  }

  // Called by piperVoiceManager after a successful download/delete so the
  // in-memory availability map (and therefore getAllVoices()) stays correct
  // without a full re-init round-trip.
  markVoiceStatus(id: string, downloaded: boolean): void {
    this.#voiceStatus.set(id, downloaded);
  }
}

function toWireDescriptor(v: (typeof PIPER_VOICE_CATALOG)[number]) {
  return {
    id: v.id,
    name: v.name,
    lang: v.lang,
    quality: v.quality,
    archiveUrl: v.archiveUrl,
    sizeBytes: v.sizeBytes,
  };
}
