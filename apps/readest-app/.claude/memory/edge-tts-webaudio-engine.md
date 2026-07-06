---
name: edge-tts-webaudio-engine
description: "Edge TTS Web Audio refactor (#3851/#2033) — gapless engine, WSOLA rate, section timeline + scrubber; branch feat/edge-tts-webaudio; release gates and design invariants"
metadata: 
  node_type: memory
  type: project
  originSessionId: 97e57af9-5961-4c92-a63e-4582178bf798
---

Branch `feat/edge-tts-webaudio` (worktree `/Users/chrox/dev/readest-feat-edge-tts-webaudio`, built 2026-07-04, NOT pushed) replaces Edge TTS per-sentence `<audio>` playback with a Web Audio pipeline: fetch MP3 at rate 1.0 (unchanged LRU + new in-flight dedup in `edgeTTS.ts`) → decode → `pcm.ts` silence trim → `timeStretch.ts` in-house WSOLA (pitch-preserved client rate, cache never refetches on rate change) → `WebAudioPlayer.ts` gapless scheduling. `SectionTimeline.ts` (measured > per-voice cps EMA in localStorage `readest-tts-voice-cps` > script defaults) powers a TTSPanel scrubber + media-session position/seekto. foliate-js fork branch `feat/tts-get-sentences` adds `getSentences` — fork PR must merge BEFORE the readest PR (submodule pin).

**Why:** #3851 first-word clipping cause is a HYPOTHESIS (Android reporter reproduced with BT off); treat as falsifiable experiment. #2033 gaps = element restarts + ~300ms Edge trailing silence.

**Load-bearing invariants (don't regress):**
- AudioContext is a module-level singleton, never closed — a fresh TTSController per tts-speak calls `stop()` not `shutdown()`, and WebKit caps ~4 live contexts (leak = permanent silence).
- Marks dispatch at AUDIBLE time (player chunk-start via onended, background-safe), never at fetch — else foliate's `#lastMark` runs ahead and prev/next/resume break.
- `endSession` fires session-end synchronously when nothing is unfinished — zero-chunk sessions (Edge outage) must not wedge controls in "playing".
- `ensureSharedAudioContext()` is called in the tts-speak gesture path BEFORE any await (WebKit autoplay window); `unblockAudio` silent element runs on ALL platforms (desktop Chromium media keys need a playing HTMLMediaElement).
- `abortSession` never suspends the context (warm output stream IS the #3851 fix); only user pause suspends.
- Word boundaries stay in original untrimmed media time; `getChunkPosition()` returns trim-relative clamped seconds; timeline sums TRIMMED durations.
- `POPUP_HEIGHT` in TTSControl.tsx is fixed and non-scrolling — grows to 200 only when a timeline-capable client is active.

**Follow-up decided (2026-07-04, not yet planned): background TTS decoupling.** App-level TTSSessionManager owns the controller; reader hook becomes attach/detach. Matrix chrox chose: close book = keep playing (headless via `section.createDocument()`); reopen SAME book = seamless reattach (adopt session + `redispatchPosition()` + CFI re-anchoring — the highlighter already re-anchors ranges through CFIs, so cross-doc ranges are safe; swap text supply to rendered doc lazily at next section boundary); open a DIFFERENT book = TTS STOPS (not "keeps playing while browsing"); explicit stop / sleep timer = stops. Fiddly bit: `getCFI` without a rendered view. Recorded in branch TODOS.md.

**How to apply:** Release gates before closing the issues (in plan Verification): WSOLA A/B listening test 0.2x-3x EN+CJK, Linux WebKitGTK decode (GStreamer), reporter-hardware beta (Soundcore Q20i iOS / Galaxy S22U screen-off), iOS lock-screen + interruption QA, e-ink `[data-eink] .range` fill check (NO eink range rule exists in globals.css), RTL slider direction. Plan + 35-decision audit trail: worktree `.agents/plans/2026-07-03-edge-tts-webaudio.md` (gitignored, local). i18n keys added ('This chapter', 'Chapter progress', 'Failed to seek', '{{elapsed}} of {{total}}') need the /i18n pass. Deferred follow-ups in TODOS.md incl. provider-agnostic local-TTS hedge ([[grimmory-native-sync]] unrelated).
