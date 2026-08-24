// Minimal clock surface MediaOverlayClient drives: satisfied by an
// HTMLAudioElement, by NativeNarrationPlayer, and by MultiTrackNarrationClock.
export interface NarrationClock {
  currentTime: number;
  playbackRate: number;
  readonly paused: boolean;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: 'ended' | 'error' | 'timeupdate', fn: () => void): void;
  removeEventListener(type: 'ended' | 'error' | 'timeupdate', fn: () => void): void;
  // Async forms for clocks whose playhead lives out of process (a native
  // player) or across several media files. The client prefers these when
  // present: assigning currentTime/playbackRate alone would race play().
  seek?(seconds: number): Promise<void>;
  setRate?(rate: number): Promise<void>;
  destroy?(): void;
}
