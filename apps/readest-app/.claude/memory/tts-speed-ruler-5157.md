---
name: tts-speed-ruler-5157
description: PR
metadata: 
  node_type: memory
  type: project
  originSessionId: 5035aa03-7594-417d-8dab-df1dba7388de
---

Issue #5078 asked for TTS speeds between 0.75x and 0.9x. PR #5157 (gojodennis) just added
0.8x/0.85x chips to `SPEED_PRESETS`. On 2026-07-17 chrox asked to instead copy a
ruler-style slider from a podcast-app screen recording (dark sheet, 0.5-3.0 tick comb,
dim labels at each 0.5, bright current-value label above the tallest active tick).

#5157 got MERGED to main (db38e2a7b) mid-review, and main also gained a generic bubble
`Slider` (@/components/Slider) stacked above the chips in the speed view. Final state:
**PR #5162 MERGED 2026-07-17** (9 commits, closed #5101; worktree pr-5157 removed) —
SpeedRuler replaces BOTH the bubble Slider and the chips; shared Slider component stays
(footerbar panels use it).
Main had independently added the caption truncate fix; our spacing commit contributes
sm:pt-4 + tests.

- `SpeedRuler.tsx` replaces `SpeedChips.tsx` in the TTS player sheet speed sub-view:
  0.5x-3x in 0.05 steps (keeps legacy presets 0.75/1.25/1.75 reachable, unlike the
  video's 0.1 steps), invisible native `<input type=range>` overlay for drag/tap/
  keyboard (same pattern as [[tts-player-redesign]] TTSScrubber), drag previews
  locally and commits on release because each commit persists settings + restarts
  the utterance; keyboard commits behind a 500 ms debounce.
- Float trap: `2.0 - 1.8 === 0.1999...` so a plain `< 0.2` label-collision test hid
  the neighbor mark one step early; compare `Math.round(Math.abs(diff) * 100) < 20`.
- Verified in headless browse by injecting the rendered markup into the live dev app
  (real Tailwind/DaisyUI CSS) in light/dark/e-ink; TTS itself cannot start headless
  (Edge TTS wss 403 + no Web Speech voices), so the sheet cannot be driven live.
- Then verified live in real Chrome (dev server + user's "TTS Test" book): synthetic
  CLICKS don't move a native range input, only left_click_drag does; expanding the
  mini player click-throughs onto whatever sheet button renders under the cursor;
  a live TTS session relocating the reader closes the sheet mid-interaction (put
  multi-step sheet interactions in one browser_batch, pause TTS first).
- Follow-up polish (e7dab3bd6): Speed caption needed max-w-full/truncate/px-1 like
  sibling captions (German "Geschwindigkeit" overflowed); main view needed sm:pt-4
  because content mt-[-4px] tucks under the mobile-only drag handle, so on desktop
  the cover clipped into the rounded top edge.
- e72ebb0c3: chapter scrubber step 1s (was ~1% of chapter) + live drag preview:
  TTSScrubber throttles (100ms, utils/throttle emitLast; guard trailing emit after
  release via dragValueRef) → TTSController.previewSeekTime — sync, uses the already
  built SectionTimeline, dispatches 'tts-highlight-mark' with `preview: true` (skips
  ttsLocation stamp + bypasses followingTTSLocationRef gate in useTTSControl) and
  draws overlay under separate SEEK_PREVIEW_KEY so playing word repaints (HIGHLIGHT_KEY)
  don't erase it; seekToTime + #clearAllHighlights clear it. Verified live in Chrome.
  Caveat seen while testing: mini player play/pause glyph desync (known open issue)
  meant "paused" audio was actually playing and auto-advanced chapters mid-test.
- 9f6646866 (buffered tail on downloaded chapters): durations live in an in-memory LRU
  fed only by decode/fetch, so cached-but-unplayed sentences stayed estimates and
  measuredFraction < 1. Fix: TTSController.ensureTimeline fires #hydrateTimelineDurations →
  ttsClient.getSectionDurations → CachingProvider → store query (manifest_marks JOIN
  entries: boundaries/duration_ms only, voice-scoped) → hydrateProvisionalDurations.
  TRAP: CachingProvider wraps BookTTSCacheStore (lazy per-book delegator), NOT
  SqliteTTSCacheStore directly — optional store methods must be forwarded there too or
  they silently no-op.
- 1082c18c0: playback-settings affordance at mini player start: custom hex-nut SVG
  (flat-top, half top edge + trailing third of upper-right edge, hollow ring center)
  with live formatRate(ttsRate) in the corner gap; taps onExpand. chrox hand-tuned the
  label offsets (start-[56%] top-[6%]) — don't second-guess those values.
- Post-PR additions: paragraph pause moved into the Speed panel (renamed "Paragraph
  Pause", own sub-view + main-row button removed); then ALL pause chips replaced by
  rulers — SpeedRuler gutted into generic `TickRuler` (min/max/step/marks/formatValue/
  formatMark; mark-hide window = 8% of range in step units), sentence 0-0.6s and
  paragraph 0-2s at 0.05s steps; GapChips/ParagraphGapChips DELETED, formatGap now
  exported from TTSPlayerSheet.tsx.
- 2c1808499: sheet main view floats the Dialog-standard close pill top-right on sm+
  (desktop has no drag handle/swipe; custom `header` props suppress the Dialog's own
  default close button — any Dialog with a custom header needs its own way out).
- 96f8d0b83 (#5101 mini player redesign): drop cover + book title (title kept in the
  container aria-label), chapter as primary line (falls back to book title), time
  0:12·-3:20 + sleep-timer countdown (MdAlarm glyph) on lower line, full-player icon
  vocabulary MdKeyboardDoubleArrow/Arrow chevrons for paragraph/sentence skips + plain
  MdPlayArrow/MdOutlinePause (no filled circle). Issue author drives while listening:
  paragraph rewind from the mini bar was the core ask. #5101 also asks for the old
  lock-screen player on iOS (point 4) — NOT addressed here.
- 2026-07-18 follow-up: chrox wanted the 0.11.18 card back as the DEFAULT — new
  `ttsPlayerStyle: 'full' | 'minimal'` view setting (Settings → TTS → Media Info →
  Player Style, default 'full'). 'full' = pre-#5162 card content (cover, book title,
  chapter·timestamps line, MdSkipPrevious/filled play blob/MdSkipNext, sentence-only);
  'minimal' = the #5101 redesign. Only the card CONTENT is styled — the #5144 stacking/
  positioning and progress track stay shared for both. Player sheet untouched.
  Trap found while extracting i18n: #5162 shipped without `pnpm i18n:extract`
  ("Playback settings"/"Paragraph Pause" keys were missing in every locale) — run
  extraction whenever UI strings change.
