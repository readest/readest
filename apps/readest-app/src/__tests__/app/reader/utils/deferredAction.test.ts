import { describe, test, expect, vi } from 'vitest';
import {
  cancelDeferredAction,
  createDeferredActionState,
  flushDeferredAction,
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

  test('cancelDeferredAction discards a pending action without running it', () => {
    const state = createDeferredActionState();
    const action = vi.fn();

    runOrDeferAction(state, true, action);
    cancelDeferredAction(state);
    flushDeferredAction(state);

    expect(action).not.toHaveBeenCalled();
  });

  test('Android long-press scenario: selection-then-touchend runs the action once', () => {
    // Models the Annotator flow on Android:
    //   1. touchstart       -> androidTouchEnd = false (defer state cleared)
    //   2. selectionchange  -> handleQuickAction (deferred because !androidTouchEnd)
    //   3. touchend         -> androidTouchEnd = true, flushDeferredAction
    const state = createDeferredActionState();
    const quickAction = vi.fn();
    let androidTouchEnd = false;

    // touchstart
    cancelDeferredAction(state);
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
  });
});
