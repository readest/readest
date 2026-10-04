---
name: tts-sentence-step-ab-repeat-5233
description: "#5233 sentence-by-sentence + A-B repeat — PR #6627 OPEN (rebased on #6626, foliate pinned to #122 squash 3e8d6fd); stepping = truncate each utterance to one sentence"
metadata:
  node_type: memory
  type: project
  originSessionId: ed2d4ff7-feb7-4b08-b302-599d0a507f21
  modified: 2026-10-04T14:41:06.479Z
---

Issue #5233 (2026-10-04). App PR readest/readest#6627 (branch `feat/tts-sentence-step`,
worktree `/Users/chrox/dev/readest-feat-tts-sentence-step`) + readest/foliate-js#122
MERGED as squash 3e8d6fd (on top of #121 = 97e44bf). #6627 rebased onto main after #6626
(the app half of #121) merged, pinned 3e8d6fd, force-pushed d13df00da; foliate branch deleted.

**Merge-order trap:** a foliate squash lands on top of whatever foliate PRs merged before it, so
pinning it drags those in. Pinning 3e8d6fd before #6626 failed 4 Webtoon seam browser tests;
the second app PR to merge must carry the newest foliate pin.

**Design (TTSController):** `pauseAfterSentence` (view setting `ttsPauseAfterSentence`) and
A-B loop points `{sectionIndex, cfi}`. While either is on, `#speak` cuts the utterance after its
first mark (`truncateSSMLAfterMark` in utils/ssml.ts) and decides at `end`. A mode switched on
mid-paragraph is caught at the next boundary (or per-mark `end` for Web/Native). Parking =
`forward(true)` in paused state (cursor + highlight on the NEXT sentence). Tint = overlay key
`tts-loop`, highlight drawer at opacity 0.12, redrawn on every relocate.

**foliate segmentation bug found on the way:** abbreviation merge regex took "Hobbit." / "it." /
"Paris." as abbreviations (from foliate 544a867). Fixed with a closed list; ICU never breaks
before lowercase so e.g./etc. need no entry.

**Verification traps:** Edge on :3007 failed (WebSocket); web Edge falls back to the
`/api/tts/edge` proxy ONLY when signed in, decided once at init — chrox's signed-in origin is
localhost:3000. Driving `toggleLoopPoint()` from JS desyncs the sheet's A-B button state (it only
updates from its own clicks) — and chrox tests in the same tab concurrently, so scripted toggles
corrupted their test ("loops whole paragraph"). Cross-chapter loop NOT verified in app; native
TTS not tested.
