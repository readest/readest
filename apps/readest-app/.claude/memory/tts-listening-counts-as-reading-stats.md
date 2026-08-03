---
name: tts-listening-counts-as-reading-stats
description: "TTS playback writes reading stats via TtsStatsRecorder; browser-verified with reader open, headless path fixed but not yet re-verified in a browser"
metadata: 
  node_type: memory
  type: project
  originSessionId: 4e4bd750-d778-4598-bc3a-9f609af23449
  modified: 2026-08-02T20:18:01.771Z
---

TTS listening now records reading statistics. **MERGED 2026-08-03 as PR #5450**
(merge commit `c1b0a4ecd`). Worktree and branch removed.

**Why it was broken:** the stats tracker's only input is `progress.pageinfo`
changes. TTS reached it purely by accident, via the relocations auto-follow
produces. With follow suppressed or the reader closed, zero stats.

**Shape:** `TtsStatsRecorder` (non-React) owned by `TTSSessionManager`, the only
thing alive during headless playback. Same KOReader `page_stat_data` rows, no
schema change. `ReadingStatsTracker` goes dormant on `tts-playback-state` =
playing for its own book hash, so the two never double-count.

**`view.getCFIProgress` is USELESS for anything headless.** `view.close()` nulls
`#sectionProgress` and `#cfiProgress` (foliate `view.js:299-311`) and
`getCFIProgress` optional-chains off them, so it returns null from the moment
the book closes. Cost a full Chrome debugging round. What survives close(), and
is enough to rebuild the same computation: `view.book`, `view.resolveCFI` (it
delegates to `book.resolveCFI`), and foliate's `PageProgress` /
`SectionProgress` constructed directly with view.js's own `1500, 1600`.

**Verified in Chrome (web, localhost dev), both paths:**
- Reader open: `READING wrote p1/17 19s` at TTS start, then
  `TTS wrote p1/17 60s` exactly 60s later, no READING writes in between.
- Book closed (headless): `p9 63s` -> `p11 30s` -> `p12 60s` (full renewal) ->
  `p14 13s` (final flush on stop), pages advancing on the layout's own 17-page
  scale.

**NOT verified:** Android screen-off, iOS lock screen, CarPlay. Untouched by
any of this.

**Two browser gotchas worth remembering:** two tabs on the same origin fight
over the OPFS handle and the second renders blank (see the `sharedDb` comment
in `statisticsDb.ts`); and `await import()` inside code under vitest fake timers
never resolves on first load, so prefer a static import.

Related: [[tts-fixes]], [[feedback-no-mock-only-platform-tests]].
