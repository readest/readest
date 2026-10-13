---
name: tts-lyric-view-5755
description: "#5755 lyric-style sentence view in the TTS player: capability gate, drag-to-seek row, buffering spinner, and the stale-geometry bug that broke auto-scroll"
metadata: 
  node_type: memory
  type: project
  originSessionId: 2178274b-ba88-4e67-bc57-d1802a3dee08
  modified: 2026-08-27T16:18:07.323Z
---

Issue #5755 (reporter: ReadAny's TTS UI). SHIPPED 2026-08-27: PR #5908 squash fabbcc640 plus
follow-up #5909 squash c04ba5a80; both branches deleted, dev fast-forwarded. NOT verified on a
device or under e-ink, and the reporter has not confirmed. Only the lyric-highlight part of
the issue was in scope (the referenced app's wider player redesign was not).

LESSON from #5909: chrox merged #5908 while the 4th review fix was still being written, so
that push never reached the PR and had to be cherry-picked onto the merged main as its own
PR. Once a PR is up, re-check its `state` before assuming a further push extends it.

**Capability gate** — the lyric sheet needs `mediaClock && textHighlight !== false`
(`TTSController.supportsLyrics()`). That is Edge/BufferedTTSClient and precisely-timed
Media Overlay narration. A paired audiobook (chapter-only timing, `textHighlight: false`)
and the direct-speak engines (Native/WebSpeech, no `mediaClock`) keep the cover player.
Exposed as `supportsLyrics` STATE in useTTSControl, synced by `syncClientCapabilities()`
(renamed from `syncAudioTransport`) — capabilities change with the voice, so a render-time
probe would not redraw the player on a voice switch.

**Data** — the existing `SectionTimeline` already IS the sentence list; `getLyrics()` just
maps it to display strings. Added `SectionTimeline.sentenceAt(index)`: NEVER round-trip an
ordinal through seconds (`positionAt` divides by rate, `sentenceAtTime` multiplies back, and
the float error lands a line early).

**Buffering** — `TTSController.isBuffering()` = `#awaitingAudio && state === 'playing'`.
`#awaitingAudio` is set at the top of `#speak` and cleared on the FIRST event the speak()
iterator yields, because for both BufferedTTSClient and MediaOverlayClient the first
`boundary` IS the first audible chunk. `getChunkPosition() == null` does NOT work as a
buffering probe — WebAudioPlayer returns a position for chunks scheduled in the future.

**Page number under the drag** — `view.getCFIProgress(cfi).location` (`.section` when
`book.rendition.layout === 'pre-paginated'`, matching FooterBar). Debounced 150ms; it
reparses the section on first use per section.

**THE BUG THAT BROKE AUTO-SCROLL** (chrox reported it mid-build): the lyric view caches
each line's centre so a scroll event is a binary search, not N reflows. The first version
re-measured only when `halfHeight` (from `scroller.clientHeight`) changed. A narrower window
re-wraps every sentence and moves every centre while the scroller's own HEIGHT never
changes -> geometry stale -> the follow scroll landed a line or two out, or off screen
entirely. Fix: `ResizeObserver` on BOTH the scroller and the content wrapper, plus a
`geometry` counter bumped when centres actually move, wired into the follow effect's deps.
Regression test: `re-parks the spoken line when a resize re-wraps the sentences`.

**Scroll feel** — distance-based, not a first-run flag (the flag gets burned by the
pre-measure pass): `> 2 * clientHeight` snaps (`auto`), nearer glides (`smooth`), e-ink
always snaps, and a move under 1px is skipped. Sentences taller than the window top-align
instead of centring (6 of 55 sentences in one Moby-Dick chapter were over-tall).

**Gesture arming** — `onTouchMove`/`onWheel`, NEVER `onPointerDown`: the follow effect
scrolls the same element, so a tap that armed seek mode would turn the next follow scroll
into a phantom drag and raise the seek row unasked.

**Buffering indicator** — three places, one source. `buffering` is polled every 400ms in
`useTTSControl` (gated on `showIndicator`) and passed down, so the lyric seek button, the
sheet's big transport button and BOTH mini-player play/pause buttons read the same flag. The
seek button swaps its glyph for a spinner (it is play-only); the transport buttons wear a
`BufferingRing` instead, because the reader must still be able to pause mid-fetch. Ring sizes
hug the glyph: 50px inside the sheet's 56px `btn-primary`, `iconSize40 - 2` on the mini
player's filled circle glyph (an Md icon's drawn circle fills only ~5/6 of its box, so +8
stood visibly off it — chrox called it "too large"), `iconSize26 + 8` on the minimal card's
outline glyph. `animate-spin` only when not e-ink.

**Layout** — no hairline joins the page label to the play button; the target line can be
five rows tall and a rule across the panel strikes through the words it points at. The line
got an outline instead — TRIED and REJECTED by chrox ("Don't show the line border"): a box
round a five-row sentence reads as clutter, and weight alone marks it while the page number
and play button flank it. Lines reserve permanent `px-14` gutters so the row never overlaps
text and raising it reflows nothing. Every line keeps a `border-transparent` so e-ink's
`eink-bordered` on the current line changes no line's height; emit exactly ONE border-colour
utility per line (naming two lets stylesheet order pick the winner — same `gap-3` + `gap-4`
trap).

`snapHeight` is 0.8 with lyrics, 0.65 without. `LYRIC_MAX_LINES = 2000` falls back to the
cover for a whole book imported as one section.

**Verified in Chrome**: follow scroll centres the spoken line; wheel scroll raises the page
number + play button; clicking play moved playback 11:24 -> 9:29 onto that line. Spinner
confirmed live 52ms after a commit and cleared when audio arrived (a far uncached sentence
buffered ~6s over Edge). Buffering ring confirmed on the sheet button (150ms after commit)
and on the mini player. To force a buffer for a screenshot: click Next Sentence ~15x fast to
outrun `preloadNextSSML`'s 4-ahead cache, or seek far down the lyric sheet — already-cached
sentences correctly show NO ring.

**CodeRabbit review (all 3 valid, fixed in a44b27110)** — (1) the seek row survived a chapter
turn, so play could seek to whatever sentence now sat at that ordinal and a carried-over
commit spun to its watchdog; fix = effect keyed to `lines` clearing seekIndex/pending/page/
seekingRef/idle timer. (2) `onGetLyrics()` rejecting (dynamic-import chunk failure) went
unhandled and left the lyric layout over an empty list; fix = catch -> unavailable. (3)
PRE-EXISTING race in `ensureTimeline`: `doc` was captured pre-await but
`#timelineSectionIndex` was read from live state post-await, so a chapter turning inside the
enumeration filed the old doc's sentences under the new section's index and every
`#timelineSectionIndex === #ttsSectionIndex` guard waved it through; fix = pin sectionIndex
before the await, discard if index or doc moved. NO test for (3): reproducing it needs a
SYNCHRONOUS section change inside the enumeration and there is no public path that does that
(`initViewTTS` no-ops once a section is loaded; every other `#initTTSForSection` caller is
private and awaits first) — would need a test-only seam, so it was skipped and said so. (4) OUT-OF-DIFF, shipped in #5909:
`loadLyrics`'s `loadingRef` guard DROPPED a reload instead of deferring it, so a chapter
turning during an in-flight fetch left the old chapter's lines (or the cover) up until the
next `tts-position`; fix = record the request and drain it in a do/while once the active
fetch settles.

CAVEAT for future Chrome MCP work: an occluded Chrome window freezes rAF, so
`scrollTo({behavior:'smooth'})` silently does nothing and `requestAnimationFrame` loops hang
the CDP call. Use `behavior:'auto'` or set `scrollTop` directly when verifying scroll code.

Related: [[abs-audio-transport-5863]], [[media-overlay-narration-5480]],
[[feedback-always-verify-on-xiaomi]]
