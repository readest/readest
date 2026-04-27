// Tiny helper for actions that need to wait for an asynchronous "ready" signal
// before running. Used by the Annotator on Android: a long-press selects text
// while the finger is still down, but the quick action (translate/dictionary/
// tts/etc.) must not fire until the user lifts (touchend), or the popup it
// opens would be dismissed by the in-progress touch.

export interface DeferredActionState {
  pending: (() => void) | null;
}

export const createDeferredActionState = (): DeferredActionState => ({ pending: null });

export const runOrDeferAction = (
  state: DeferredActionState,
  shouldDefer: boolean,
  action: () => void,
): void => {
  if (shouldDefer) {
    state.pending = action;
    return;
  }
  state.pending = null;
  action();
};

export const flushDeferredAction = (state: DeferredActionState): void => {
  const fn = state.pending;
  if (!fn) return;
  state.pending = null;
  fn();
};

export const cancelDeferredAction = (state: DeferredActionState): void => {
  state.pending = null;
};
