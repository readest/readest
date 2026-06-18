import { describe, test, expect, vi } from 'vitest';
import {
  beginGesture,
  createDeferredActionState,
  flushDeferredAction,
  isLongPressHold,
  runOrDeferAction,
} from '@/app/reader/utils/deferredAction';

describe('deferredAction', () => {
  test('runs action immediately when shouldDefer is false', () => {
    const state = createDeferredActionState();
    const action = vi.fn();

    runOrDeferAction(state, false, action);

    expect(action).toHaveBeenCalledTimes(1);
    expect(state.pending).toBeNull();
  });

  test('stores action without running when shouldDefer is true', () => {
    const state = createDeferredActionState();
    const action = vi.fn();

    runOrDeferAction(state, true, action);

    expect(action).not.toHaveBeenCalled();
    expect(state.pending).toBe(action);
  });

  test('flushDeferredAction runs the latest deferred action exactly once', () => {
    const state = createDeferredActionState();
    const action = vi.fn();

    runOrDeferAction(state, true, action);
    flushDeferredAction(state);

    expect(action).toHaveBeenCalledTimes(1);
    expect(state.pending).toBeNull();

    flushDeferredAction(state);
    expect(action).toHaveBeenCalledTimes(1);
  });

  test('successive defers replace the pending action so flush runs only the last one', () => {
    const state = createDeferredActionState();
    const first = vi.fn();
    const second = vi.fn();

    runOrDeferAction(state, true, first);
    runOrDeferAction(state, true, second);
    flushDeferredAction(state);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  test('beginGesture discards a pending action without running it', () => {
    const state = createDeferredActionState();
    const action = vi.fn();

    runOrDeferAction(state, true, action);
    beginGesture(state);
    flushDeferredAction(state);

    expect(action).not.toHaveBeenCalled();
  });

  test('runs the action only once per gesture even when triggered repeatedly', () => {
    // iOS long-press emits multiple selectionchange events for the same
    // selection; each runs immediately (shouldDefer false). Only the first
    // should fire so e.g. the system-dictionary sheet is presented once.
    const state = createDeferredActionState();
    const action = vi.fn();

    runOrDeferAction(state, false, action);
    runOrDeferAction(state, false, action);
    runOrDeferAction(state, false, action);

    expect(action).toHaveBeenCalledTimes(1);
  });

  test('beginGesture re-arms the action for the next gesture', () => {
    const state = createDeferredActionState();
    const action = vi.fn();

    runOrDeferAction(state, false, action);
    runOrDeferAction(state, false, action); // same gesture: blocked
    expect(action).toHaveBeenCalledTimes(1);

    beginGesture(state); // pointerdown/touchstart of the next gesture
    runOrDeferAction(state, false, action);
    expect(action).toHaveBeenCalledTimes(2);
  });

  test('iOS long-press scenario: multiple selectionchange events look up the word once', () => {
    // Models the Annotator flow on iOS (no native-touch deferral):
    //   1. pointerdown      -> beginGesture (re-arm)
    //   2. selectionchange  -> runOrDeferAction(false) -> dictionary lookup
    //   3. selectionchange  -> runOrDeferAction(false) -> blocked (same gesture)
    //   4. selectionchange  -> runOrDeferAction(false) -> blocked (same gesture)
    const state = createDeferredActionState();
    const lookup = vi.fn();

    beginGesture(state); // pointerdown
    runOrDeferAction(state, false, lookup); // selectionchange #1
    runOrDeferAction(state, false, lookup); // selectionchange #2 (echo)
    runOrDeferAction(state, false, lookup); // selectionchange #3 (echo)

    expect(lookup).toHaveBeenCalledTimes(1);
  });

  test('Android long-press scenario: selection-then-touchend runs the action once', () => {
    // Models the Annotator flow on Android:
    //   1. touchstart       -> beginGesture (defer state cleared + re-armed)
    //   2. selectionchange  -> handleQuickAction (deferred because !androidTouchEnd)
    //   3. touchend         -> androidTouchEnd = true, flushDeferredAction
    const state = createDeferredActionState();
    const quickAction = vi.fn();
    let androidTouchEnd = false;

    // touchstart
    beginGesture(state);
    androidTouchEnd = false;

    // selectionchange triggers the quick action
    runOrDeferAction(state, !androidTouchEnd, quickAction);
    expect(quickAction).not.toHaveBeenCalled();

    // touchend: gate opens, pending action fires
    androidTouchEnd = true;
    flushDeferredAction(state);
    expect(quickAction).toHaveBeenCalledTimes(1);

    // A subsequent stray touchend must not re-run the action
    flushDeferredAction(state);
    expect(quickAction).toHaveBeenCalledTimes(1);

    // An iOS-style echo (immediate trigger) after touchend within the same
    // gesture must not re-run it either.
    runOrDeferAction(state, false, quickAction);
    expect(quickAction).toHaveBeenCalledTimes(1);
  });
});

describe('isLongPressHold', () => {
  const MIN = 300;

  test('no recorded pointerdown (e.g. mouse) always qualifies', () => {
    expect(isLongPressHold(0, 999_999, MIN)).toBe(true);
  });

  test('a held long-press (elapsed >= threshold) qualifies', () => {
    // iOS surfaces a touch selection only after the ~500ms OS long-press.
    expect(isLongPressHold(1000, 1000 + 500, MIN)).toBe(true);
  });

  test('exactly at the threshold qualifies', () => {
    expect(isLongPressHold(1000, 1000 + MIN, MIN)).toBe(true);
  });

  test('a quick tap (elapsed < threshold) does NOT qualify', () => {
    // The tap-to-deselect bug: a tap re-reports the lingering selection a few
    // tens of ms after its pointerdown — must not fire the instant action.
    expect(isLongPressHold(1000, 1000 + 40, MIN)).toBe(false);
  });
});
