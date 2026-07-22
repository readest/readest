// The playout seam of the TTS architecture: BufferedTTSClient schedules
// synthesized audio through this interface and reads the media clock back
// for word highlighting and the section timeline. The driver is chosen per
// platform by OS constraints, not preference:
// - WebAudioPlayer (web/desktop/Android): gapless sample-accurate scheduling
//   of decoded PCM, WSOLA rate applied at prepare time.
// - NativeAudioPlayer (iOS Tauri): in-process AVPlayer playing the raw
//   compressed chunks, because WKWebView renders WebAudio in the GPU process
//   under an audio session the app cannot own (Now Playing, pause retention,
//   AirPods, mute switch all key off session ownership).
//
// The two schedule methods are deliberately distinct rather than unified:
// the web path must decode to PCM to time-stretch, the native path must NOT
// decode (AVPlayer streams the compressed file and time-stretches natively).
// A driver implements exactly one of them.

import type { ChunkTiming, TTSAudioBuffer, WebAudioPlayerEvent } from './WebAudioPlayer';

export interface TTSAudioPlayer {
  // The web driver resolves with its AudioContext; callers only await.
  ensureContext(): Promise<unknown>;
  // Returns a generation token; events for older generations must be ignored
  // by the caller. The onEvent callback delivers chunk-start (audible),
  // session-end, and error events.
  startSession(onEvent: (event: WebAudioPlayerEvent) => void): number;
  // PCM path (web): schedule a prepared buffer gaplessly.
  scheduleChunk?(generation: number, buffer: TTSAudioBuffer, timing: ChunkTiming): void;
  // Raw path (native): enqueue the compressed chunk; resolves with its
  // duration in seconds.
  scheduleRawChunk?(
    generation: number,
    index: number,
    data: ArrayBuffer,
    opts: { gapSec: number },
  ): Promise<number>;
  // Backpressure: resolves when the player can accept another chunk, false
  // when the session died first.
  waitUntilReady(generation: number): Promise<boolean>;
  endSession(generation: number): void;
  abortSession(): void;
  pauseContext(): Promise<void>;
  resumeContext(): Promise<void>;
  isUserPaused(): boolean;
  // Live rate change; only drivers that time-stretch at playout implement it.
  setRate?(rate: number): Promise<void>;
  // Media clock: original (rate-1.0) media time of the audible chunk, the
  // reference frame word boundaries are expressed in.
  getPlaybackPosition(generation: number): { chunkIndex: number; mediaTimeSec: number } | null;
  shutdown(): Promise<void>;
}
