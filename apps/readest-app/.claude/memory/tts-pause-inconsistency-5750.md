---
name: tts-pause-inconsistency-5750
description: "#5750 TTS pauses inconsistent: gaps rate-scaled twice + paragraph boundary on wall clock; MERGED #5753, device verify pending"
metadata: 
  node_type: memory
  type: project
  originSessionId: 9a35def3-a67c-4607-92bb-91ffc157006a
  modified: 2026-08-17T07:14:41.777Z
---

Issue #5750 ("TTS pause is inconsistent", filed 2026-08-17) had two independent
root causes, both fixed by PR #5753, MERGED 2026-08-17 as `9213c6af1`.
Device verify still pending: nobody has heard the new pauses on hardware.

1. **Gaps were rate-scaled twice.** `TTSPlayerSheet.scaleGap` (added by #5326,
   2026-07-26, an outside contributor PR that only touched the UI) persisted
   `base/rate^0.6` into `ttsSentenceGap`/`ttsParagraphGap`, and
   `BufferedTTSClient.#runScheduler` + `TTSController.#delayParagraphGap` still
   divided by `rate`. Effective gap was `base/rate^1.6`: 0.60s between sentences
   at 0.5x, 0.085s at 2x, correct ONLY at 1.0x. That is why the reporter heard
   "either perfect or too short/long".
   Fix: `scaleGapForRate` in `src/services/tts/gap.ts` is the ONLY scaling site;
   the derivation moved into `useTTSControl.handleSetRate`, the single funnel
   both the speed ruler and the RSVP overlay's `tts-set-rate` already pass
   through (the bus path used to persist `ttsRate` without re-deriving the gaps,
   leaving them scaled for the previous rate).
   The persisted gap stays a value already scaled for the current rate, so no
   settings migration is needed.

2. **Paragraph boundaries were wall clock, not audio clock.** One `speak()` is
   one paragraph; the next session was built after a JS `setTimeout`, then
   teardown + `#preprocessSSML` + `preloadSSML` + synth + `decodeAudioData`, and
   the first chunk landed at `ctx.currentTime + SCHEDULE_SAFETY_SEC`. None of
   that was compensated, while gaps INSIDE a paragraph are sample-exact via
   `session.nextStartTime`. Dialogue-heavy fiction (one sentence per paragraph)
   takes the slow path on every pause.
   Fix: `WebAudioPlayer` records `#carryOverEndTime` when a session ends
   naturally and seeds the next session's `nextStartTime` from it plus
   `SessionOptions.startAfterPreviousSec`; `TTSController` skips
   `#delayParagraphGap` for clients reporting the new `scheduledGaps`
   capability (web path only, NOT NativeAudioPlayer/iOS). A session aborted
   mid-playback carries nothing over, so stop/skip stays immediate.

`#prepareChunkBuffer` (decode, silence-trim, WSOLA, edge-fade) is NOT the main
cause but contributes: it replaces Edge's prosody-dependent trailing silence
(~0.18s lead / ~0.8s trail, see [[edge-tts-baked-silence-ios-native-5414]]) with
one constant, so `.` vs `?` vs a comma split all get the same pause.

CI traps this branch hit (both fixed on the PR):
- `TTSController.setParagraphGap` forwards to `ttsEdgeClient` like
  `setSentenceGap` does, so EVERY test that mocks `@/services/tts/EdgeTTSClient`
  needs the method or the mock throws at session start and TTS never runs.
  `tts-auto-advance.browser.test.tsx` is the one `pnpm test` does NOT catch:
  browser tests only run under `pnpm test:browser` (CI shard 1). Run it for any
  change under `src/services/tts/`.
- `handleSetRate` must derive the gaps BEFORE its `if (!ttsController) return`:
  the RSVP overlay persists `ttsRate` with playback stopped, so an early return
  leaves the stored pauses scaled for the old rate (CodeRabbit caught this).

Side effect of fix 2 worth watching on device: the page turn and the first
sentence highlight of a paragraph now fire up to a paragraph gap earlier
(before the audio starts) instead of after the JS sleep.

**Why:** two scaling sites and a derived value cached in a synced setting are
the shape of this bug; the same trap will bite any new rate entry point.
**How to apply:** never scale a gap outside `scaleGapForRate`, and derive
rate-dependent settings at `handleSetRate`, not in the component that happens to
own the slider.
