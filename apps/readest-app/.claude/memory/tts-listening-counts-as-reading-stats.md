---
name: tts-listening-counts-as-reading-stats
description: "TTS playback now writes reading stats via TtsStatsRecorder; committed on feat/tts-reading-stats, device verification for background/CarPlay still pending"
metadata: 
  node_type: memory
  type: project
  originSessionId: 4e4bd750-d778-4598-bc3a-9f609af23449
  modified: 2026-08-02T18:36:12.157Z
---

TTS listening now records reading statistics. Committed 2026-08-03 as
`bc1d8d5e5` on branch `feat/tts-reading-stats` (worktree
`/Users/chrox/dev/readest-feat-tts-reading-stats`, based on origin/main
`4f44b79ec`). Not pushed, no PR yet.

**Why it was broken:** the stats tracker's only input is `progress.pageinfo`
changes. TTS reached it purely by accident, via the relocations auto-follow
produces. With follow suppressed (`useTTSControl.ts` `followingTTSLocationRef`)
or the reader closed, zero stats.

**Shape of the fix:** `TtsStatsRecorder` (non-React) owned by
`TTSSessionManager`, because that is the only thing alive during headless
playback. Writes the same KOReader `page_stat_data` rows, no schema change.
`ReadingStatsTracker` goes dormant on `tts-playback-state` = playing for its
own book hash, so the two never double-count.

**Known limitation, accepted deliberately:** when auto-follow is suppressed and
the user paged away, the credited page is the DISPLAYED one, not the narrated
one. Rationale: they are looking at it.

**Still unverified (cannot be unit tested, see
[[feedback-no-mock-only-platform-tests]]):** background/screen-off listening on
Android, iOS lock screen, and CarPlay. The headless page number is derived from
`view.getCFIProgress(cfi).fraction` x `BookConfig.progress[1]`; that whole path
has only ever run under vitest. Also unverified: that `getBookData` really
survives `clearViewState` in a real headless session (inferred from
`#saveToDisk` reading `getConfig` successfully, not observed).

Related: [[tts-fixes]], [[tts-mini-player-tuning-5310]].
