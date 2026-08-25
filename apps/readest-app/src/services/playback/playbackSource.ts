// The playback seam.
//
// ttsMediaBridge (lock screen, CarPlay, Android Auto, media keys) and
// TTSSessionManager (single-slot session ownership, sleep timer, headless
// persistence) were written against TTSController directly. They only ever
// touched the narrow surface below, so both now consume PlaybackSource and a
// second source kind (audiobook playback) can bind to exactly the same
// background-session machinery without forking it.
//
// TTSController conforms structurally and unchanged apart from its `kind`
// tag: every name here is the name it already used.

/**
 * Transit-state union shared by all playback sources (identical to the
 * private TTSState union in TTSController).
 *
 * 'stopped' is a TRANSIT value, not a terminal one: it is reached on every
 * paragraph advance and chapter transition. Terminal stops are signalled by
 * `terminated` plus the 'tts-session-ended' event. Both consumers gate on
 * `state === 'stopped' && !terminated` to filter transit churn, so a new
 * source must use 'stopped' the same way.
 */
export type PlaybackState =
  | 'stopped'
  | 'playing'
  | 'paused'
  | 'stop-paused'
  | 'backward-paused'
  | 'forward-paused'
  | 'setrate-paused'
  | 'setvoice-paused';

export interface PlaybackInfo {
  position: number;
  duration: number;
  measuredFraction: number;
}

// The transport's time skips, shared by the audiobook player and a paired
// audiobook read along: a long hop forward, a shorter one back to re-hear the
// phrase just missed.
export const SKIP_FORWARD_SEC = 30;
export const SKIP_BACKWARD_SEC = 15;

/**
 * The narrow surface ttsMediaBridge and TTSSessionManager consume.
 *
 * Event contract (names kept from TTS so TTSController conforms unchanged):
 *  - 'tts-state-change'   detail: { state: PlaybackState }
 *  - 'tts-speak-mark'     detail: TTSMark (drives lock-screen metadata + position)
 *  - 'tts-session-ended'  detail: { reason: 'ended' | 'error' }
 *  - 'tts-highlight-mark' detail: { cfi: string } (TTS only; audiobooks never emit)
 */
export interface PlaybackSource extends EventTarget {
  readonly kind: 'tts' | 'audiobook';
  readonly state: PlaybackState;
  readonly terminated: boolean;
  readonly isViewAttached: boolean;
  stopAtChapterEnd: boolean;
  start(): Promise<void>;
  pause(): Promise<void>;
  forward(byMark?: boolean): Promise<void>;
  backward(byMark?: boolean): Promise<void>;
  setRate(rate: number): Promise<void>;
  seekToTime(seconds: number): Promise<void>;
  ensureTimeline(): Promise<unknown>;
  supportsPlaybackInfo(): boolean;
  getPlaybackInfo(): PlaybackInfo | null;
  detachView(): void;
  shutdown(): Promise<void>;
}
