// The synthesis-side seam of the TTS architecture: a SpeechProvider turns
// text into compressed audio plus word-boundary timings, and nothing else.
// Scheduling, decoding, time-stretch, playout, word tracking, and media
// sessions all live above this seam (BufferedTTSClient and the players), so
// a new engine — another HTTP service, a local model, a system voice
// synthesizing to buffers — is one adapter implementing this contract.
//
// Invariants every provider must uphold:
// - The playback RATE is never sent to the provider. Rate is a playout
//   concern (WSOLA on the web path, AVPlayer timeDomain on iOS), which keeps
//   synthesized audio rate-independent and therefore cacheable.
// - `boundaries` use the Edge wire shape (100ns ticks from stream start,
//   verbatim text spans); providers convert at their edge. Absent boundaries
//   simply degrade word highlighting to sentence highlighting.

import type { TTSWordBoundary } from '@/libs/edgeTTS';
import type { TTSVoice, TTSVoicesGroup } from '../types';

export interface SpeechSynthesisRequest {
  lang: string;
  text: string;
  voice: string;
  pitch: number;
}

export interface SpeechSynthesisResult {
  // Compressed audio exactly as delivered by the engine. Callers own the
  // buffer (providers must hand out a fresh copy per call: WebKit's
  // decodeAudioData detaches its input).
  audio: ArrayBuffer;
  boundaries: TTSWordBoundary[];
}

// A failure that is permanent for the given sentence (retrying the same
// request cannot succeed). The buffered client skips the sentence instead of
// retrying; anything else thrown from synthesize() is treated as transient.
export class SpeechSynthesisPermanentError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SpeechSynthesisPermanentError';
  }
}

// A failure that ends the whole session (or download): retrying or skipping
// cannot help, e.g. the daily synthesis quota is used up. The buffered client
// stops at once instead of retrying or skipping ahead.
export class SpeechSynthesisFatalError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SpeechSynthesisFatalError';
  }
}

// The fatal error's message when the daily synthesis quota is used up.
export const DAILY_QUOTA_EXCEEDED = 'DAILY_QUOTA_EXCEEDED';

// Who a prefetch serves: live listening or a chapter download. Windowed
// providers admit and size the two differently.
export type TTSLane = 'listen' | 'download';

export interface PrefetchOptions {
  // Listen lane only: preloads of upcoming paragraphs. They fill windows after
  // the requests the current paragraph is waiting on.
  background?: boolean;
  // Called once per request when its audio arrives (or is already cached), so
  // the client can count it as buffered before playback asks for it.
  onDelivered?: (req: SpeechSynthesisRequest, result: SpeechSynthesisResult) => void;
}

export interface SpeechProvider {
  // Stable identifier: persisted voice/client preferences and cache
  // namespaces key off it, so renaming one is a migration.
  readonly id: string;
  // Human-readable engine name for voice-group headers.
  readonly label: string;
  // Probe/initialize the transport; false means the engine is unavailable
  // (its voices render disabled in the picker).
  init(): Promise<boolean>;
  getAllVoices(): Promise<TTSVoice[]>;
  // `options.background`: a cache fill for a background prefetch; nobody is
  // listening for it yet, so a windowed provider keeps it at preload priority.
  synthesize(
    req: SpeechSynthesisRequest,
    signal: AbortSignal,
    options?: PrefetchOptions,
  ): Promise<SpeechSynthesisResult>;
  // Engine-specific default-voice policy for a language's candidate list
  // (already filtered and sorted); return undefined to accept the first.
  pickDefaultVoice?(voices: TTSVoice[]): string | undefined;
  // The order the picker lists a language's voices in. Absent: the reader's
  // locale first, then by name.
  compareVoices?(a: TTSVoice, b: TTSVoice): number;
  // Multilingual voices, offered whatever the book's language, in groups the
  // picker shows separately (one per configured service). Absent: one group
  // of the voices that match the book's language.
  groupVoices?(voices: TTSVoice[]): Omit<TTSVoicesGroup, 'disabled'>[];
  // Last-resort voice when nothing matched and no voice was ever selected.
  readonly fallbackVoiceId?: string;
  // Never voice a sentence with a voice of another language: when a language
  // has no voice, the client asks for '' and the provider skips the sentence.
  // Off by default (Edge falls back to a multilingual or last-used voice).
  readonly sameLanguageVoicesOnly?: boolean;
  // Whether synthesized audio may be persisted. Some services forbid
  // storing their output; CachingProvider bypasses the store when false.
  readonly cacheable?: boolean;
  // Settings outside the request that change the audio for the same voice
  // (a user-edited model or style prompt): part of the cache key, so editing
  // them never replays audio made under the old settings.
  cacheScope?(req: SpeechSynthesisRequest): string;
  // Release provider resources (network handles, cache databases) when the
  // owning client shuts down.
  shutdown?(): Promise<void>;
  // Window hint for providers that synthesize several sentences per request:
  // these requests will be synthesized soon, in this order. Aborting `signal`
  // withdraws them. Providers that synthesize per request omit it.
  prefetch?(
    reqs: SpeechSynthesisRequest[],
    lane: TTSLane,
    signal: AbortSignal,
    options?: PrefetchOptions,
  ): void;
  // The cache already has this sentence (e.g. a synced pack arrived): a
  // prefetching provider settles it and stops synthesizing it.
  fulfill?(req: SpeechSynthesisRequest, result: SpeechSynthesisResult): void;
}
