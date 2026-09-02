// Transfer sound cues for Nearby BookDrop. Per-device preference like the
// other LocalSend prefs. Deliberately plain <audio> elements — no Web Audio
// graph — and every play is best-effort: webview autoplay policy can reject
// a cue that fires without a user gesture, in which case the toast and
// haptic feedback are the accepted floor.

const SOUNDS_KEY = 'readest-localsend-sounds';

export type TransferCue = 'start' | 'done' | 'fail';

const CUE_ASSETS: Record<TransferCue, string> = {
  start: '/assets/localsend-start.wav',
  done: '/assets/localsend-done.wav',
  fail: '/assets/localsend-fail.wav',
};

/** Whether transfer cues play on this device. Defaults to on. */
export function isLocalSendSoundsEnabled(): boolean {
  try {
    return localStorage.getItem(SOUNDS_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function setLocalSendSoundsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(SOUNDS_KEY, enabled ? 'true' : 'false');
  } catch {
    /* localStorage unavailable — the default (enabled) stands */
  }
}

/** E-ink devices never play cues; otherwise the per-device toggle decides. */
export function shouldPlayTransferCue(opts: { eink: boolean }): boolean {
  if (opts.eink) return false;
  return isLocalSendSoundsEnabled();
}

const cueElements = new Map<TransferCue, HTMLAudioElement>();

function cueElement(cue: TransferCue): HTMLAudioElement {
  let audio = cueElements.get(cue);
  if (!audio) {
    audio = new Audio(CUE_ASSETS[cue]);
    audio.preload = 'auto';
    cueElements.set(cue, audio);
  }
  return audio;
}

/**
 * Unlock audio playback under webview autoplay policies: on the first user
 * gesture, play each cue muted once so later programmatic plays (transfer
 * complete/fail, auto-accepted receives) are allowed. Call from a
 * pointerdown listener; repeat calls are no-ops.
 */
let primed = false;
export function primeTransferCues(): void {
  if (primed || typeof Audio === 'undefined') return;
  primed = true;
  for (const cue of Object.keys(CUE_ASSETS) as TransferCue[]) {
    try {
      const audio = cueElement(cue);
      audio.muted = true;
      const play = audio.play();
      play
        ?.then(() => {
          audio.pause();
          audio.currentTime = 0;
          audio.muted = false;
        })
        .catch(() => {
          audio.muted = false;
        });
    } catch {
      /* priming is best-effort */
    }
  }
}

export function playTransferCue(cue: TransferCue, opts: { eink: boolean }): void {
  if (typeof Audio === 'undefined') return;
  if (!shouldPlayTransferCue(opts)) return;
  try {
    const audio = cueElement(cue);
    audio.currentTime = 0;
    void audio.play()?.catch(() => {
      /* autoplay rejected — toast/haptics carry the notification */
    });
  } catch {
    /* best-effort */
  }
}
