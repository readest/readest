---
name: tts-forward-autoadvance-vs-user-skip-5355
description: "TTSController.forward() serves both the speak loop's auto-advance and every user skip surface, so any gate there must distinguish them"
metadata: 
  node_type: memory
  type: project
  originSessionId: 5b2350a3-0230-430d-9682-aa7e632fbea2
  modified: 2026-07-27T16:21:15.588Z
---

`TTSController.forward()` is a shared funnel with two callers that look identical from inside it:

- the speak loop continuing on its own (4 call sites in `#speak()`: `lastCode === 'end'`, the empty-marks skip, the native-error skip, and the no-SSML section advance)
- **every** user skip surface: the player sheet and mini player next / next-sentence buttons, plus `ttsMediaBridge`'s `nexttrack` and `seekforward` media-session handlers

Both arrive with `state === 'playing'`, so `isPlaying` cannot tell them apart. PR #5355 ("End of Chapter" sleep timer) gated inside `#handleNavigationWithoutSSML` on `isForward && isPlaying` and consequently killed playback whenever the user pressed skip at a chapter boundary — including from the lock screen and CarPlay, where there is no obvious recovery.

Fix (pushed to #5355 on 2026-07-28): `forward(byMark = false, isAutoAdvance = false)`, gate on `isAutoAdvance`, pass `true` only from the `#speak()` call sites. `#handleNavigationWithoutSSML` keeps its original 2-arg signature so `backward()` is untouched.

**Why:** any future "don't continue past X" feature (chapter end, bookmark, sleep marker) lands in the same place and will make the same mistake.

**How to apply:** when adding a stop/gate condition to `forward()`, ask which of the two callers it means. Pin both with tests — `src/__tests__/services/tts-controller.test.ts` has a 3-section mock view and `tts-session-manager.test.ts` a `FakeController`, so both sides are cheap to cover. Note `#handleNavigationWithoutSSML` fires `#speak()` un-awaited, so a test asserting the resumed `'playing'` state must flush a macrotask first.

Related: [[tts-fixes]], [[native-tts-offline-autoadvance-4613]], [[tts-test-teardown-microtask-flake]]
