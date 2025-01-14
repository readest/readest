import { TTSGranularity } from '@/types/view';

export type TTSMessageCode = 'boundary' | 'error' | 'end';

export interface TTSMessageEvent {
  code: TTSMessageCode;
  message?: string;
  mark?: string;
}

export interface TTSVoice {
  id: string;
  name: string;
  lang: string;
  disabled?: boolean;
}

export interface TTSClient {
  init(): Promise<boolean>;
  speak(ssml: string, signal: AbortSignal, preload?: boolean): AsyncIterable<TTSMessageEvent>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  setRate(rate: number): Promise<void>;
  setPitch(pitch: number): Promise<void>;
  setVoice(voice: string): Promise<void>;
  getAllVoices(): Promise<TTSVoice[]>;
  getVoices(lang: string): Promise<TTSVoice[]>;
  getGranularities(): TTSGranularity[];
  getVoiceId(): string;
}
