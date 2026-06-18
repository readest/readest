// Tiny helper for the Annotator's instant quick action (translate/dictionary/
// tts/etc.). It solves two related touch-gesture problems:
//
//   * On Android a long-press selects text via selectionchange while the finger
//     is still down, so the action is deferred until touchend — otherwise the
//     popup it opens is dismissed by the in-progress touch (closes #3935).
//   * A single long-press can emit MULTIPLE selectionchange events for the same
//     selection. iOS is the worst offender: it re-confirms the native selection
//     after our deselect(), firing the action again. Running per event stacked
//     duplicate popups — e.g. two/three system-dictionary sheets on iOS. The
//     `fired` latch makes the action run at most once per gesture; `beginGesture`
//     re-arms it at the next touchstart/pointerdown.

export interface DeferredActionState {
  pending: (() => void) | null;
  // Whether the quick action has already run for the current gesture.
  fired: boolean;
}

export const createDeferredActionState = (): DeferredActionState => ({
  pending: null,
  fired: false,
});

const runOnce = (state: DeferredActionState, action: () => void): void => {
  if (state.fired) return;
  state.fired = true;
  action();
};

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
  runOnce(state, action);
};

export const flushDeferredAction = (state: DeferredActionState): void => {
  const fn = state.pending;
  if (!fn) return;
  state.pending = null;
  runOnce(state, fn);
};

// Start of a new touch gesture: drop any pending action and re-arm the latch so
// the next action can run. Call on touchstart/pointerdown.
export const beginGesture = (state: DeferredActionState): void => {
  state.pending = null;
  state.fired = false;
};

// A touch instant quick action must only fire from a long-press hold, never a
// quick tap. After the system dictionary is dismissed iOS re-selects the word;
// tapping outside to deselect it is a WebView pointerdown that re-arms the latch,
// and a racy selectionchange can re-report the lingering selection a few tens of
// ms later — which used to re-open the dictionary (~1/3 of taps). A genuine iOS
// touch selection only appears after the OS long-press (~500ms), so we require
// at least `minHoldMs` to have elapsed since the gesture's pointerdown.
//
// `pointerDownTime === 0` means no touch pointerdown was recorded (e.g. mouse on
// desktop), where this gate does not apply and the action always qualifies.
export const isLongPressHold = (pointerDownTime: number, now: number, minHoldMs: number): boolean =>
  pointerDownTime === 0 || now - pointerDownTime >= minHoldMs;
