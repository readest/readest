import { TTSGranularity, TTSVoice, TTSVoicesGroup } from './types';

type TTSMessageCode = 'boundary' | 'error' | 'end';

export interface TTSMessageEvent {
  code: TTSMessageCode;
  message?: string;
  mark?: string;
}

export interface TTSClient {
  name: string;
  initialized: boolean;
  init(): Promise<boolean>;
  shutdown(): Promise<void>;
  speak(ssml: string, signal: AbortSignal, preload?: boolean): AsyncIterable<TTSMessageEvent>;
  pause(): Promise<boolean>;
  resume(): Promise<boolean>;
  stop(): Promise<void>;
  setPrimaryLang(lang: string): void;
  setRate(rate: number): Promise<void>;
  setPitch(pitch: number): Promise<void>;
  setVoice(voice: string): Promise<void>;
  getAllVoices(): Promise<TTSVoice[]>;
  getVoices(lang: string): Promise<TTSVoicesGroup[]>;
  getGranularities(): TTSGranularity[];
  // Whether this client reports word-boundary timings during playback so the
  // controller can highlight word-by-word (and suppress the sentence highlight).
  supportsWordBoundaries(): boolean;
  getVoiceId(): string;
  getSpeakingLang(): string;
  // Playback position within the currently audible sentence, in trimmed media
  // seconds at rate 1.0, clamped to [0, sentenceDuration]. Optional: only
  // clients with a real audio clock (Edge via Web Audio) implement it; the
  // section timeline treats absence as sentence-granularity positions.
  getChunkPosition?(): number | null;
}
