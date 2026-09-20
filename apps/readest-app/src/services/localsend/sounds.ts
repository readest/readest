// The one sound Nearby BookDrop makes: a completed transfer. Per-device
// preference like the other LocalSend prefs. Deliberately a plain <audio>
// element — no Web Audio graph — and every play is best-effort: a webview that
// rejects the play leaves the toast and haptic feedback, which is the accepted
// floor.

const SOUNDS_KEY = 'readest-localsend-sounds';

const DONE_ASSET = '/assets/localsend-done.wav';

/** Whether the transfer cue plays on this device. Defaults to on. */
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

/** E-ink devices never play the cue; otherwise the per-device toggle decides. */
export function shouldPlayTransferCue(opts: { eink: boolean }): boolean {
  if (opts.eink) return false;
  return isLocalSendSoundsEnabled();
}

let cueElement: HTMLAudioElement | undefined;

/** Play the transfer-complete cue. Nothing else in BookDrop makes a sound. */
export function playTransferDoneCue(opts: { eink: boolean }): void {
  if (typeof Audio === 'undefined') return;
  if (!shouldPlayTransferCue(opts)) return;
  try {
    if (!cueElement) {
      cueElement = new Audio(DONE_ASSET);
      cueElement.preload = 'auto';
    }
    cueElement.currentTime = 0;
    void cueElement.play()?.catch(() => {
      /* play rejected — toast/haptics carry the notification */
    });
  } catch {
    /* best-effort */
  }
}
