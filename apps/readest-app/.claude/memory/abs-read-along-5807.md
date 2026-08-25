---
name: abs-read-along-5807
description: "#5807 read-and-listen: pair an Audiobookshelf audiobook with an EPUB and play it through Read Aloud (streamed, not downloaded). PR #5856 (commit 60d1a1760) on branch feat/abs-read-along, opened 2026-08-25"
metadata: 
  node_type: memory
  type: project
  originSessionId: 5f8c6211-2832-487f-a8e2-2f375d8c80fd
  modified: 2026-08-24T18:58:22.513Z
---

**#5807** ("Read and Listen to the book at the same time"): let a reader pair an
audiobook that lives on a configured Audiobookshelf server with an EPUB and hear
it through the existing Read Aloud mini player (chapter sync, scrubber, sleep
timer, lock screen), streamed rather than copied to the device. Design doc:
`.claude/plans/2026-08-25-abs-read-along-design.md`. Worktree
`/Users/chrox/dev/readest-feat-abs-read-along`, branch `feat/abs-read-along`
from origin/main `ded443512`. Commits `60d1a1760` (feature) + `6b81a9c60`
(review fixes) + `eb57ecb13` (page-follow fix), PR **#5856** MERGED 2026-08-25
(merge commit `a6c61c736`); worktree removed. Device-verify debt from Phase 1
(iOS build/streaming, CarPlay/Android Auto seam, e-ink player) still open.

**Page-follow fix (`eb57ecb13`) — was reported as a regression; it is NOT one.**
The text page did not turn with the audio within a section (only advanced at
section boundaries), in BOTH pairing modes. Root cause, PRE-EXISTING since
#5754: for a chapter-only pairing (textTiming 'approximate', textHighlight
false), `MediaOverlayTTS.getPlaybackRange` returns a ONE-CHARACTER proportional
reading dot, and `dispatchSpeakMark` dispatched only that 1-char cfi on
`tts-highlight-mark`. `useTTSControl.handleHighlightMark` resolved it to a
1-char range and passed THAT to `followSentenceAcrossPages` -> `pageBreakFraction`
got length 1, found nothing off-page, never turned. Exact EPUB 3 Media Overlays
(#5480) were unaffected (getPlaybackRange returns the full par range for
'exact'), which is the page-follow the user remembered working. `origin/main`
dispatches the same 1-char cfi (my ABS diff never touched this path). FIX:
`dispatchSpeakMark` now also emits `sentenceCfi` = getCFI of the FULL par range
(`range`), equal to `cfi` when textHighlight is true (no extra getCFI for synth
voices / exact MO); `handleHighlightMark` resolves `sentenceCfi` in the ON-SCREEN
doc (must be on-screen doc, not the TTS's internal doc, for getBoundingClientRect)
and drives `followSentenceAcrossPages` from that full range, still scrolling the
reading dot from the 1-char `cfi`. Test in media-overlay-controller.test.ts
asserts sentenceCfi carries the whole chapter while cfi stays 1-char (harness
getCFI encodes range.toString()).

**Xiaomi VERIFIED (2026-08-25, `eb57ecb13`).** Device path to dev ABS recovered
(the earlier "unreachable" was only the CSP-blocked WebView `window.fetch`;
`adb shell curl http://192.168.2.3:13378/ping`=200, and the app uses tauriFetch/
ExoPlayer natively). Opened the pre-paired Alice EPUB (hash 32bb20d7...), Read
Aloud streamed the ABS Alice audiobook, native `playout_position` advanced in
real time (+5006ms/5s), and the page followed the narration through Chapter 3
(page turned within the section while the chapter label held). User confirmed
"It's fixed." CDP page-change signal that worked: `.progressinfo` "N / 112" +
nav `aria-label` "Next Page, Page N"; the reader content is NOT a top-level
iframe (iframeCount 0) so cross-frame text reads fail — use the progress
indicator instead.

**CodeRabbit review round (6b81a9c60):** 6 of 7 findings fixed, 1 pushed back.
Fixed: (a) virtual duration = max(startOffset+duration) not sum, in BOTH
buildAbsPairingSource and MultiTrackNarrationClock ctor (gap/overlap clamps
chapter ends right); (b) preview capped to the track boundary (absPreviewClip
now returns the track `duration`, dialog caps end to trackDur-start); (c)
MultiTrackNarrationClock.seek awaits an in-flight `#pending` load before a
same-track seek then re-derives (else the load's startAt overwrites the scrub);
(d) encodeURIComponent the media token in buildAbsMediaUrl (no-op for JWTs);
(e) eink-bordered on the ABS picker's lone Back button; (f) docs wording.
PUSHED BACK on "gate preview on TTSCapabilities not mobileNative": the
AudiobookPreviewPlayer is not a TTSClient (no capabilities), and the
`appPlatform==='tauri' && isMobileApp` gate is a real audio-session-ownership
platform check, same as the pre-existing local-file preview and isIOSTauri()/
isNativeNarrationPlatform(). All 7 threads replied on GitHub.

**Approach = bridge the two existing halves, not a new player.** Reuses the
#5754 local-pairing machinery (`PairedAudiobook` in device-local `config.json`,
the anchor/review wizard, `MediaOverlayClient`) and the #5801 ABS client/store.
See [[audiobookshelf-integration-phase1]].

**Key shape decisions:**
- An ABS pairing is ONE virtual file on the item's GLOBAL timeline, not one file
  per track: ABS times chapters globally and they span media files (dev
  instance: Pride & Prejudice "Ch. 7-8" runs 918s-2446s across two MP3s; Peter
  Pan = 17 tracks / 4 chapters), which the local per-file clip model can't
  express. `PairedAudiobook.source?: { kind:'audiobookshelf', serverId, itemId,
  tracks[] }` (new, in types/book.ts). Virtual file path = `abs://<serverId>/<itemId>`.
- `MultiTrackNarrationClock` (new, mediaOverlay/) presents the tracks to
  `MediaOverlayClient` as ONE `NarrationClock` (also new, extracted interface):
  a global seek lands on the file holding the position, a file running out rolls
  into the next, only the last file's `ended` surfaces. Drives `HtmlAudioClock`
  on web/desktop and the client's own `NativeNarrationPlayer` (given track URLs)
  on mobile. New `NarrationAudioSource.resolveTracks?` hook selects this path;
  the 3 `#native && #player` seek/setRate special-cases in MediaOverlayClient
  became `seek()`/`setRate()` on the clock interface.
- `absNarrationTracks(source)` builds tokened URLs via `buildAbsMediaUrl(server,
  contentPath)` (moved to `utils/audiobook.ts` — dep-free so client mocks don't
  need importOriginal), reading the LIVE token per call (rotation-safe, same as
  openAudiobook.ts). Imported into TTSController via `await import(...)` inside
  `resolveTracks` — a top-level import pulled absServerStore's settings graph
  into TTSController and broke 5 tts-controller test suites' EdgeTTSClient mock
  (`DEFAULT_SENTENCE_GAP_SEC` missing). Lazy import is load-bearing.
- Native http streaming: iOS AVPlayer already branched on `http(s)://`; ADDED the
  same branch to Android `loadContinuousFile` (Kotlin, tauri-plugin-native-tts)
  = `MediaItem.fromUri(Uri.parse(url))`. Needed for narration AND wizard preview.
- Wizard: new "Choose from Audiobookshelf" card (shown only when
  `listPairableAbsBooks(library)` is non-empty = live, non-podcast, non-orphan
  ABS books) → filterable picker → `loadAbsPairingSource` fetches the expanded
  item and `buildAbsPairingSource` converts it (chapters from media.chapters
  dropping empty spans, else one-per-track named by file; narrator from
  narrators/narratorName). Anchor+review steps unchanged. `persistStreamedPaired-
  Audiobook` saves without copying; `removePairedAudiobook`/`migratePaired-
  Audiobook` skip disk ops when `association.source` is set. Summary shows
  "Streamed from <server>", Remove says "Unpair".

**Out of scope (follow-ups):** pushing listening position back to the ABS server
while reading along (the /player AudiobookController does this via
AbsProgressSyncer; narration has no session hooks) — reading progress still
syncs through Readest; cross-device sync of the association (fileless, could
travel); auto-suggesting the pairing from the EPUB's ABS `ebookFile`.

**Verification (2026-08-25):** `pnpm test` (9885 pass, 2 pre-flake retried
green), `pnpm lint`, `pnpm format:check` all clean. Xiaomi (adb 368b0948,
`dev-android` release APK installed) via CDP + `readest://book/<hash>` deep
link: picker listed all 10 dev-instance audiobooks; choosing Pride & Prejudice
fetched its expanded item (35 audio chapters), anchor→review→save → "Audiobook
paired successfully"; summary card = "35 audio chapters · 13:18:47 · Streamed
from 192.168.2.3:13378"; unpair confirm "Unpair this audiobook?" → "Audiobook
unpaired." Native player accepted the http track URL (session/index 0, no
reject). **LIVE audio byte-streaming (position advancing) NOT confirmed** — the
dev ABS instance (192.168.2.3:13378) went unreachable from both Mac and the
VPN'd phone mid-verification; the wizard's own expanded-item fetch proves the
phone reaches it when the VPN is up, so this is a network-availability gap, not
a code fault. Retry playback when the server is reachable. See
[[feedback-always-verify-on-xiaomi]].
