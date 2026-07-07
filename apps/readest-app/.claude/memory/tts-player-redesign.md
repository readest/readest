---
name: tts-player-redesign
description: TTS control redesigned to mini-player + Dialog player sheet (Apple Books/ElevenLabs style); replaces floating icon/popup/TTSBar; showTTSBar retired; PR #4996
metadata: 
  node_type: memory
  type: project
  originSessionId: d8af2d26-c714-44f4-b2f2-dfe08676fe87
---

TTS player redesign built 2026-07-07, **PR readest/readest#4996 MERGED same day** (squash 17de9357d; worktree + local branch cleaned). Spec + plan in `.claude/plans/2026-07-07-tts-player-redesign{,-plan}.md`. Late tweaks: main-view sheet header label dropped; progress line moved to card BOTTOM edge; eink = 1px hairline track + solid base-content fill + buffer hidden (mini), 1px border on `.tts-scrubber` (sheet); chrox added `audio-track`/`audio-played-part` class hooks + `not-eink:` prefixes on the mini progress divs before merge.

Architecture: `usePlaybackInfo` hook (poll/monotonic-hold/2% total quantization/optimistic seek+rollback, extracted from old TTSProgressRow) feeds `TTSMiniPlayer` (persistent bottom card: 3px progress line w/ buffer-ahead fill from `measuredFraction`, sentence transport, stop, tap-to-expand, exports `TTS_MINI_PLAYER_CLEARANCE=64` consumed by FoliateViewer whenever `ttsEnabled`) and `TTSScrubber` (gradient track: currentColor/40%/15% color-mix; `.tts-scrubber` CSS in globals.css). `TTSPlayerSheet` = Dialog bottom sheet (snapHeight 0.65, desktop `sm:!w-[420px]`) with cover, scrubber, 5-button transport, `SpeedChips` presets (off-preset rate like default 1.3 merges as extra chip), Voice/Sleep-Timer NavigationRow sub-views. Deleted: reader TTSPanel/TTSBar/TTSIcon; `showTTSBar` removed from ViewSettings/constants.

**Why:** chrox asked to "redesign the TTS control like modern TTS apps (ElevenLabs/Kindle/Apple Books)"; chose mini-player+sheet structure, sentence/paragraph transport (works on ALL engines; time seek Edge-only via scrubber), preset speed chips. Absorbed TODOS items: sticky-bar scrubber + buffer-ahead indicator.

**How to apply:**
- Sheet mounts only while open (`showPlayerSheet &&` gate in TTSControl) so hidden hooks don't poll; DictionarySheet is the mounting precedent.
- Transport clusters and scrubbers are `dir='ltr'` (audio-timeline convention) — the final review caught the mini player missing this under RTL; wrap the button cluster, keep timer chip outside.
- Rate persistence reads `useSettingsStore.getState()` at call time (stale-closure class #4780); persists BOTH viewSettings.ttsRate and globalViewSettings.ttsRate.
- Native voices (no timeline): scrubber hidden, show `{{time}} left in chapter` from chapterRemainingSec estimates.
- Live-feedback wave (same day, chrox watching dev-web): sheet controls collapsed to ONE row of speed/voice/timer buttons (speed chips now a 'speed' sub-view; SpeedChips exports formatRate); ttsDuration EMA (alpha 0.2) replaced with CUMULATIVE chars/secs ratio per voice (cap 3600s rescale, legacy {cps,n} migrates as 30s prior) to stop elapsed-time jumping; mini player unmounts while sheet open; TTSController #clearAllHighlights on every section entry (stale last-word leak in preloaded neighbor views) + reapplyCurrentHighlight skips the sentence fallback while playing in word mode (page-turn sentence flash).
- **OPEN BUG seen live:** isPlaying glyph desyncs at section transitions (CTA shows play while audio runs; tapping it calls start() which re-speaks from stored ttsLocation = position jump). Repro: watch CTA across chapter auto-advance. Likely a transit state-change ('paused'-flavored or missed 'playing') in useTTSControl handleStateChange.
- Deferred follow-ups from final review: e-ink visual pass (stale+disabled opacity compounds ~30%), two usePlaybackInfo edge tests, dead `!groups` branch in sheet, two usePlaybackInfo instances don't share seek suppression.
- Verified live in dev-web Chrome: mini player + buffer-ahead fill, sheet + sub-views, drag seek + optimistic hold, back-to-TTS pill, section auto-advance label/timeline reset, stop button, zh-CN i18n. NOT yet: timer countdown chip, native-voice degradation, background NowPlayingBar reattach, e-ink, RTL, mobile gestures. Dev-env traps: stale serwist SW on localhost served year-old locale JSON (unregister + caches.delete); dev-web on port 3001 when 3000 busy.

Related: [[edge-tts-webaudio-engine]], [[tts-background-session-decoupling]], [[feedback_use_worktree]].
