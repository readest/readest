---
name: abs-audio-transport-5863
description: "#5863 part 2: paired-audiobook transport skips 30s forward / 15s back and by audiobook chapter; unmapped audio sub-chapters are absorbed by the mapped chapter before them; plus the Rust cover thumbnailer's WebP decode failure. MERGED #5865 (c6a1901a5, 2026-08-25); worktree and branch removed"
metadata: 
  node_type: memory
  type: project
  originSessionId: df16ba89-b91a-468f-8466-54cc3988ee1f
  modified: 2026-08-25T05:03:24.780Z
---

**#5863** (winstonma feedback on #5807 read-along). Part 1 (page turns on
scrub) was ANSWERED by chrox as expected behaviour, NOT in scope. Part 2 + the
WebP warning were done 2026-08-25 on branch `fix/abs-audio-controls-5863`
(worktree `/Users/chrox/dev/readest-fix-abs-audio-controls-5863`, from
origin/main `8d44c6b66`), PR **#5865** (commits `c865945b4` + `50d57e30d` nix hash + `a3d60d3ad` docs) MERGED 2026-08-25 as `c6a1901a5`; worktree removed via `pnpm worktree:rm`, local branch deleted. Reporter (winstonma) verify pending.

**Root causes found:**
- `loadPairedAudiobookSection` (services/tts/pairedAudiobook.ts) built one
  NarrationPar per MAPPED ebook chapter with clip = that audio chapter's own
  span. An audio chapter with no EPUB TOC entry to map to (1.1, 1.2) was in no
  par, so continuous playback jumped from Chapter 1's clip end straight to
  Chapter 2's clip and the audio for 1.1/1.2 was NEVER played.
- In that mode marks ARE chapters, so `nextMark`/`prevMark` ("Next Sentence",
  media-session `seekforward`) skipped a whole chapter; `next`/`prev` did the
  same thing. That is the reporter's "unexpected jumping".
- WebP: `src-tauri/Cargo.toml` built `image` 0.25 with only jpeg/png/gif.
  `parser_common::maybe_resize_cover` falls back to writing the ORIGINAL bytes
  as `cover.png` on decode failure, so a WebP cover lands on disk misnamed and
  `cover_thumbnail::encode_thumbnail` then fails too. Fix = add `"webp"`
  feature (pure-Rust `image-webp`, Cargo.lock at MONOREPO ROOT changes).

**Design shipped:**
- `mappedAudioSpans` in pairedAudiobook.ts: a mapped chapter's clip absorbs the
  UNMAPPED chapters that follow it in the same file (up to the next mapped
  one; trailing ones at file end too). Chapters BEFORE the first mapped one in
  a file stay unplayed; gaps between chapters stay unplayed. Run slices divide
  the absorbed span. `narratedAudioChapters(book, association)` lists every
  reachable audio chapter in recording order with its narrating sectionIndex;
  `adjacentAudioChapter(chapters, audioHref, seconds, dir)` picks the skip
  target (backward >3s into a chapter restarts it, mirrors
  AudiobookTimeline.prevChapterStart).
- `TTSController.usesAudioTransport()` = `mediaClock && textHighlight ===
  false` (capability-gated per docs, never client identity). `forward(byMark)`
  / `backward(byMark)` branch on it (NOT on auto-advance, `isAutoAdvance`):
  byMark -> `#seekBy(+SKIP_FORWARD_SEC=30 / -SKIP_BACKWARD_SEC=15)` in RECORDING seconds
  (constants MOVED to `services/playback/playbackSource.ts`, shared with
  AudiobookController; user decided 30/15 over a symmetric 10s mid-session)
  (`seconds / ttsRate` because SectionTimeline positions run at rate);
  else `#stepAudioChapter(dir)`: same section -> `seekToTime(timeline time of
  the chapter start)` (same par = seekToChunkPosition, no restart, no page
  turn); other section -> stop(handover) + `#initTTSForSection` + new
  `#startSectionAt` -> `#resumeAt` (the tail of seekToTime, factored out).
  Mirrors `AudiobookController.forward(byMark)` exactly, so ttsMediaBridge's
  seekforward/nexttrack handlers needed NO change.
- UI: `useTTSControl` keeps `audioTransport` as STATE synced after init, after
  an adopted session's attachView, and after setVoice (a per-render read of the
  controller left the mini player on its first-render sentence labels on
  device: adoption flips ttsClientsInited before attach resolves). Labels reuse
  the audiobook player's existing 'Back 15 Seconds'/'Forward 30 Seconds' +
  'Previous/Next Chapter' keys (NO new locale keys; a first pass added
  'Back/Forward 10 Seconds' to 34 locales and was reverted). Icons: user picked
  the circular-arrow-with-number style (screenshot) -> `RiReplay15Line` /
  `RiForward30Line` (react-icons/ri; Material has no 15, Tabler's
  rewind-backward-15 puts the number under the arrow). PlayerView (ABS player)
  still uses the Tb icons, untouched.
- docs/read-along-narration.md documents both behaviours.

**Trade-off to flag:** an audio chapter a user deliberately left unmapped
because it is NOT in the EPUB (bonus track between chapters) now plays as the
previous chapter's tail instead of being skipped. Documented; no wizard
"ignore" state exists.

**Verification 2026-08-25:** `pnpm test` 10068 pass / 815 files; `pnpm lint`,
`format:check`, `fmt:check`, `clippy:check`, `test:rust` (112) all green. Rust
test `webp_covers_decode_to_jpeg_thumbnails` embeds a 38-byte lossless WebP
made with `cwebp` (no PIL on this Mac) and reproduced the exact issue log line
before the feature flag. Xiaomi 368b0948 NOT attached; Boox Leaf5 (ec8fafd,
Android 13, ONYX) was attached with Readest installed and reaching the dev ABS
server (192.168.2.3:13378, readest/readest123; Alice audiobook item
2fe8f68c-5596-43e7-be9b-5db5e74c8f23 = 10 chapters/3518s, EPUB fixture
`src/__tests__/fixtures/data/sample-alice.epub` = 12 chapters, hash
32bb20d7452627491831bb64a8d0dd94 once imported).

**Boox device pass (first build, 10s steps) VERIFIED:** ABS server added +
synced through the settings UI, Alice paired via the wizard with EPUB Chapter 2
set to "No audio" (audio 02 unmapped -> absorbed into Chapter 1's clip), Read
Aloud streamed; sheet labels correct; seek tap = native +10.5s with no section
change; six seeks then ONE transition across the Chapter 9->10 boundary;
Next Chapter = one `[TTS] Initialized narration for section N` per tap; a
mid-chapter session played Chapter 4 to its natural end then one transition.
ONE-OFF NOT REPRODUCED (4 tries): the very first seek tap closed the sheet and
the session sat at Chapter 7 ~2 min later. NOT A BUG: on e-ink the elapsed
display only refreshes on sentence-level `tts-position` events
(`usePlaybackInfo` isEink branch, "no 1s repaints"), so a chapter-only pairing
looks frozen between seeks/marks while native position advances.

**Boox device pass (FINAL build, 30/15 + hook state) VERIFIED 2026-08-25:** mini
player labels flip from sentence to 后退 15 秒/快进 30 秒 within seconds of
start (clients init after the card mounts, by design); sheet = 上一章/后退 15
秒/暂停/快进 30 秒/下一章; +30 moved native 95.1->128.2s, -15 back to 116.1s;
下一章 = one section transition (Chapter 6->7); 上一章 at 5s in restarted the
chapter. Left on the Boox: the dev ABS server row + synced ABS books, the
imported Alice fixture (hash 32bb20d7...) with its pairing, and
/sdcard/Download/sample-alice.epub.

**Boox CDP recipe (zh-CN UI):** `drive.mjs` = Runtime.evaluate with page helpers
(clickLabel/clickText/setValue/waitFor); labels from public/locales/zh-CN:
Settings Menu=设置菜单, Settings=设置, Integrations=集成, Sync Now=立即同步,
TOC footer=目录 (opens the sidebar; the header's 书籍内容 is the CONTENT region,
not a toggle), Book Menu=书籍菜单, Pair Audiobook=配对有声书, Speak=朗读 (footer
Button -> tts-speak), Open Read Aloud player=打开朗读播放器, Next Chapter=下一章.
Synthetic `.click()` works for React buttons; `#abs-server-url/#abs-username/
#abs-password` + form submit; VIEW intent via MediaStore id (see e2e helper);
`window.__TAURI_INTERNALS__.invoke('plugin:native-tts|playout_position')`
reads the native clock (positionMs within the current track); patching that
invoke does NOT intercept the bundle's own calls. `eventDispatcher` is
module-private (no window shortcut for manage-audiobook/tts-speak).

**PR follow-ups 2026-08-25:** `50d57e30d` bumped `nix/package.nix` cargoHash to
`sha256-a3KVOqYsO1LQF1D0Maxrq9MsLgjYQFgyU0oemn4Xkn0=` (Cargo.lock gained
image-webp; fod-hashes check printed the `got:` value, per
[[nix-fod-hash-staleness]]) -> check PASSES. `a3d60d3ad` reworded docs +
TTSController comments + PR body to "reachable audiobook chapters" (review
note: narratedAudioChapters excludes audio before the first mapped chapter, so
"the audiobook's own chapter list" contradicted the doc).

Related: [[abs-read-along-5807]], [[audiobookshelf-integration-phase1]],
[[feedback-always-verify-on-xiaomi]], [[i18n-extract-prunes-keys]].
