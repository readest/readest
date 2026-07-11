// One-shot hand-off for an Android Auto "Resume last book" tap: the car cold
// launches the app with `readest://book/{hash}?autoplay=tts`; the deep-link
// handler records the hash here, and the reader consumes it once that book's
// view has inited to start read-aloud. Module-scoped so it survives the
// library -> reader navigation (like the deep-link cold-start guards).
let pendingHash: string | null = null;

export const setPendingTTSAutoplay = (hash: string | null): void => {
  pendingHash = hash;
};

// Returns true exactly once for the matching hash, then clears the request.
export const consumePendingTTSAutoplay = (hash: string): boolean => {
  if (pendingHash && pendingHash === hash) {
    pendingHash = null;
    return true;
  }
  return false;
};
