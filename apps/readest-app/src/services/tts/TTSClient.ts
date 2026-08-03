import { TTSGranularity, TTSVoice, TTSVoicesGroup } from './types';

type TTSMessageCode = 'boundary' | 'error' | 'end';

export interface TTSMessageEvent {
  code: TTSMessageCode;
  message?: string;
  mark?: string;
}

// What the active engine can actually do, so the controller and UI degrade
// uniformly instead of probing per-feature or comparing client identities.
export interface TTSCapabilities {
  // Reports word-boundary timings during playback: the controller highlights
  // word-by-word and suppresses the sentence highlight.
  wordBoundaries: boolean;
  // Has a real audio clock: getChunkPosition() returns positions, enabling
  // the scrubber/seek via the section timeline.
  mediaClock: boolean;
  // The inter-sentence gap setting applies.
  gapControl: boolean;
  // Rate changes apply to in-flight audio without restarting the session.
  liveRateChange: boolean;
  // Consecutive blocks are one continuous recording rather than separate
  // utterances, so the controller must not insert its own pauses between them —
  // the recording already contains the pauses its narrator made.
  continuousTimeline?: boolean;
}

export interface TTSClient {
  name: string;
  initialized: boolean;
  init(): Promise<boolean>;
  shutdown(): Promise<void>;
  speak(ssml: string, signal: AbortSignal, preload?: boolean): AsyncIterable<TTSMessageEvent>;
  pause(): Promise<boolean>;
  resume(): Promise<boolean>;
  // `handover` marks the stop the controller performs between two consecutive
  // utterances of the same session, as opposed to a real stop. An engine whose
  // timeline is continuous uses it to stay rolling instead of silencing itself;
  // engines that synthesize per utterance must stop either way and ignore it.
  stop(handover?: boolean): Promise<void>;
  setPrimaryLang(lang: string): void;
  setRate(rate: number): Promise<void>;
  setPitch(pitch: number): Promise<void>;
  setVoice(voice: string): Promise<void>;
  getAllVoices(): Promise<TTSVoice[]>;
  getVoices(lang: string): Promise<TTSVoicesGroup[]>;
  getGranularities(): TTSGranularity[];
  getCapabilities(): TTSCapabilities;
  // Ordered sentence labels for a section (timeline enumeration), consumed
  // by clients with a persistent cache to drive section-pack compaction.
  registerSectionManifest?(section: number, marks: string[]): void;
  // Cached per-ordinal audio durations (seconds) for a section under the
  // current voice; empty when the client has no persistent cache.
  getSectionDurations?(section: number): Promise<Map<number, number>>;
  getVoiceId(): string;
  getSpeakingLang(): string;
  // Playback position within the currently audible sentence, in trimmed media
  // seconds at rate 1.0, clamped to [0, sentenceDuration]. Only meaningful
  // when capabilities.mediaClock is true; the section timeline treats absence
  // as sentence-granularity positions.
  getChunkPosition?(): number | null;
  // How far through the chunk now sounding, 0..1. Reported as a single value
  // rather than position/duration so it cannot skew between two calls, and so a
  // playback rate change cannot be applied to one but not the other.
  getChunkProgress?(): number | null;
}
