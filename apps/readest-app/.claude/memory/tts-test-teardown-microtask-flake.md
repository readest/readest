---
name: tts-test-teardown-microtask-flake
description: "Flaky vitest unhandled error: TTSController deferred queueMicrotask dispatch fires after jsdom teardown; Node global CustomEvent rejected by jsdom EventTarget"
metadata: 
  node_type: memory
  type: project
  originSessionId: a1862d1a-c5cd-4b21-aed7-62a3290222ba
---

Flaky CI (surfaced on PR #5149's sharded `test_web_app (2)`, fixed in #5151):
an UNHANDLED error (all tests pass, but the shard exits 1) —
`TypeError: Failed to execute 'dispatchEvent' on 'EventTarget': parameter 1 is
not of type 'Event'` from `TTSController.ts` `set state` line ~212.

Mechanism: `set state` defers its event dispatch to avoid re-entrancy —
`queueMicrotask(() => this.dispatchEvent(new CustomEvent('tts-state-change', ...)))`.
The native-TTS tests in `tts-controller.test.ts` call `speak()` UN-AWAITED
(speak runs a detached `#speak` loop) and only assert on an early side-effect
via `vi.waitFor`, on a LOCALLY-created controller that `afterEach` never
stopped (afterEach only stopped the shared `controller`). Past the test the
loop keeps mutating state; its deferred dispatch fires after the file's jsdom
env is torn down, where `new CustomEvent` resolves to Node 20+'s GLOBAL
`CustomEvent` (not jsdom's) while `this.dispatchEvent` is still jsdom's
EventTarget → realm mismatch → reject. Sharding (`vitest --shard=2/2`) changes
file order enough to expose it; re-running the job passes (flaky).

Fix was TEST-ONLY (no prod change — a browser realm never tears down
mid-microtask, so deferred dispatch is a legit re-entrancy guard, and a
try/catch in `set state` would be a test seam, see
[[feedback_no_test_seams_in_prod]]): track every controller that starts a
detached speak loop (push in the two `makeAndroidNativeController` helpers into
a `speakingControllers[]`), and in `afterEach` `await c.stop()` each (stop()
aborts the loop's AbortSignal and awaits it) then
`await new Promise(r => setTimeout(r, 0))` to drain pending microtasks while
jsdom is alive.

General lesson: any test that fires an un-awaited async loop which later
dispatches DOM events (directly or via queueMicrotask) must halt that loop in
afterEach, or the escaped dispatch throws an unhandled error at env teardown.
Reproduce locally with the exact CI shard cmd: `pnpm test:pr:web:unit --shard=2/2`.

Related: [[tts-browser-e2e-harness]], [[native-tts-screenlock-keepalive-4408]].
