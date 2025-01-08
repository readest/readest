export type TTSMessageCode = 'boundary' | 'error' | 'end';

export interface TTSMessageEvent {
  code: TTSMessageCode;
  message?: string;
  mark?: string;
}

export interface TTSClient {
  init(): Promise<void>;
  speak(ssml: string): AsyncIterable<TTSMessageEvent>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  setRate(rate: number): Promise<void>;
  setPitch(pitch: number): Promise<void>;
}
