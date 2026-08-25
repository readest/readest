## Read-Along Narration

Readest can play a recorded human narration instead of synthesizing speech while
keeping the rest of Read Aloud: page-following, chapter skip, the scrubber and
seek, speed, sleep timer, lock-screen and CarPlay controls, and background
sessions. Narration can come from an EPUB 3 Media Overlay, which also supplies
timed text highlighting, or from a separate audiobook paired to a reflowable
EPUB.

### Prior art

Synchronized read-along is a feature the major ecosystems have converged on:

- **Kindle Immersion Reading** — Kindle text highlighted in step with an Audible
  narration, via Amazon's Whispersync for Voice pairing.
- **[Continuum](https://continuumreader.app/)** — pairs DRM-free ebooks and
  audiobooks by asking for one known chapter match, filling the rest in sequence,
  and requiring the user to review mismatches before saving.
- **Audible Read & Listen** (launched February 2026) — the same thing inside the
  Audible app, with word-level highlighting as the narrator speaks. Requires
  owning both the Audible audiobook *and* the matching Kindle ebook.
- **Spotify** is working the same problem from a different angle: **Follow Along**
  syncs time-stamped illustrations and graphics to the narration, and **Page
  Match** uses OCR on a photographed page to jump the audiobook to that spot (and
  shows the page number matching the current audio position). Position matching
  and companion media rather than synchronized text highlighting — adjacent, not
  equivalent.

Readest's version needs no account or matching entitlements. Any narrated EPUB
you own or generate plays on every platform Readest runs on, and DRM-free MP3,
M4A, or M4B files can be paired locally with an ordinary EPUB.

The recording is read from **EPUB 3 Media Overlays**: a SMIL file per spine
section whose `<par>` elements each pair a text fragment
(`chapter.xhtml#sentence-3`) with a clip of a narration audio file
(`clipBegin`/`clipEnd`). Those pairs are the publisher's own text-to-audio sync
points, which is why read-along playback needs no alignment of its own.

### Getting a narrated EPUB

Commercially narrated read-along EPUBs exist but are uncommon. If you have an
ebook and a separate professionally narrated audiobook — the usual case —
generate the Media Overlays yourself.

**[Storyteller](https://storyteller-platform.dev/)** is the recommended tool. It
is a self-hosted platform that takes an ebook plus its audiobook, transcribes
the audio with Whisper, force-aligns the transcript against the book text, and
emits an **EPUB 3 with Media Overlays** — audio and SMIL packaged inside the
container. Because the output is standard EPUB, it plays in Readest with no
Readest-specific step. Source:
[gitlab.com/storyteller-platform/storyteller](https://gitlab.com/storyteller-platform/storyteller);
the alignment method is described under
[How it works](https://storyteller-platform.dev/docs/the-algorithm/).

Alternatives if you'd rather not run a service:
[syncabook](https://github.com/r4victor/syncabook) (CLI, aimed at LibriVox +
Gutenberg pairings) and [aeneas](https://github.com/readbeyond/aeneas) (the
forced-alignment library underneath several such tools).

Readest deliberately does **not** infer sentence or word timings itself. Tools
like Storyteller remain the route to exact phrase-level highlighting. Pairing a
separate audiobook instead provides chapter-level alignment for navigation and
playback, without drawing a text highlight that would imply finer timing.

### Pairing a separate audiobook

The pairing wizard follows Continuum's anchor-and-review flow:

1. Open a reflowable EPUB's book menu and choose **Pair Audiobook**.
2. Select one M4B file or a naturally ordered set of MP3/M4A tracks, or, when
   an Audiobookshelf server is configured, **Choose from Audiobookshelf** and
   pick one of its audiobooks to stream instead.
3. Choose one ebook chapter and the audio chapter or track known to match it.
4. Readest fills the mapping in both directions by position. Review every row,
   leave ebook chapters without audio, reuse an audio chapter where necessary,
   and ignore extra tracks before creating the association.

When one audio chapter is reused for consecutive ebook chapters, Readest treats
them as one continuous run. Chapters in the same spine document share one text
span; runs crossing spine documents divide the clip into equal chapter slices
so playback continues instead of restarting the recording at every section
boundary.

Audiobook chapter lists are often finer than the EPUB's table of contents
(1, 1.1, 1.2, 2 ...). An audio chapter left without an ebook chapter plays as
part of the mapped chapter before it in the same file, so the recording is
heard in full and the page keeps following it proportionally. Audio before
the first mapped chapter of a file (opening credits, say) is not played.

The wizard reports chapter-count mismatches rather than hiding them. Audio stays
under `Books/<book hash>/audiobook/`, while the association is stored in that
book's device-local `config.json`; neither is uploaded by Readest cloud or file
sync. Normal reading progress is still synced, so another device with its own
local pairing resumes at the same ebook chapter. Replacements use new file paths
and persist the new association before removing old audio. Re-importing or
deduplicating an edited EPUB copies the paired files and rewrites those paths
before retiring the previous book directory.

An Audiobookshelf pairing stores no audio on the device. The association itself
is still device-local, recording the server, item and track list
(`PairedAudiobook.source`); playback streams each file with the server's current
access token, so it needs that association's server row and a network
connection. It is otherwise the same device-local association,
and removing it only unpairs. Listening position is not reported back to the
Audiobookshelf server while reading along; reading progress still syncs through
Readest as usual.

### Using it

1. Import a narrated EPUB as usual, or pair a separate audiobook from the book
   menu.
2. Open **Read Aloud**. The recording is selected automatically and appears at
   the top of the **Voice** list (named from available narrator metadata, or
   "Book narration" when none is declared).
3. To use a synthetic voice for that book instead, pick one from the same Voice
   list. The choice is remembered per book; picking the narrator again returns
   to the recording.

Two behaviours worth knowing:

- **The highlight follows the recording exactly.** Media Overlays time whole
  elements, so the highlighted unit is whatever the publisher marked — usually a
  sentence or phrase, sometimes a word. Word-level SMIL (common in children's
  read-alongs, and what Storyteller produces at its finest granularity) gives
  true word-by-word highlighting for free. Readest does not interpolate word
  positions inside a clip, so the highlight can never drift out of sync.
- **Paired audiobooks do not highlight text.** A separate audiobook has no
  sentence or word timings, so highlighting a whole mapped chapter would be
  misleading. Readest instead maps the current page proportionally into that
  chapter's audio span when narration starts and offers a return-to-narration
  action if the reader moves elsewhere while audio continues.
- **Paired audiobooks move by audio.** With no sentences to step by, the
  transport takes an audio player's vocabulary: the small step is the
  audiobook player's skip (30 seconds forward, 15 back), the large step moves
  to the previous or next reachable audiobook chapter, one a mapped chapter's
  clip covers, so audio before the first mapped chapter stays out of reach
  (backward more than a few seconds into a chapter restarts it), and the
  lock-screen skip and track buttons do the same. The page turns to another
  ebook chapter only when the target audio chapter is narrated by a different
  mapped chapter; a sub-chapter inside the current one is a seek within its
  text span.
- **Unnarrated sections are skipped.** Publishers routinely leave front matter,
  indexes and notes out of the recording. Playback steps over those sections
  rather than stalling on silence; starting Read Aloud in unnarrated front
  matter jumps forward to the first narrated section. To have those sections
  read too, choose a synthetic voice.

### How it works

Narration reuses the whole Read Aloud stack by swapping the two seams it already
had. `TTSClient` abstracts *where audio comes from*; foliate's `TTS` class
abstracts *how text is cut into marks*. Recorded narration is exactly "a
different audio source with a different segmentation".

Embedded Media Overlay support lives in `src/services/tts/mediaOverlay/`:

| File | Role |
| --- | --- |
| `parseSmil.ts` | Pure SMIL parsing: `parseSmilClock` (SMIL clock values) and `parseSmil` (walks `<body>`/`<seq>`/`<par>` in document order, resolving hrefs against the SMIL file). |
| `MediaOverlaySection.ts` | Per-section index: resolves each par's text fragment to a DOM `Range` in the section document, groups pars into blocks by nearest block-level ancestor, and builds the SSML the controller consumes. |
| `MediaOverlayTTS.ts` | Stands in for foliate's `TTS`. Same navigation surface (`start`/`resume`/`next`/`prev`/`nextMark`/`prevMark`/`from`/`setMark`/`getLastRange`), but marks come from the par list. |
| `MediaOverlayClient.ts` | `implements TTSClient`. Plays clips off one `HTMLMediaElement`, emitting a `boundary` as each par becomes audible. |

Separate audiobooks reuse the same client and mark iterator. The additional
pieces are `src/services/audiobook/` (metadata, positional mapping, and local
storage) plus `src/services/tts/pairedAudiobook.ts`, which turns each mapped TOC
chapter into a `NarrationPar`. A chapter table embedded in an M4B supplies clip
boundaries; a standalone track without chapter metadata becomes one clip.

An Audiobookshelf item (`src/services/audiobook/absPairing.ts`) is converted to
ONE virtual file on the item's global timeline rather than one file per track:
ABS times its chapters globally and they routinely span media files, which the
per-file clip model cannot express. `MultiTrackNarrationClock` then presents the
item's tracks to the client as a single `NarrationClock`: seeks land on the file
holding the position, a file running out rolls into the next, and only the last
file's end surfaces as `ended`. It drives `HtmlAudioClock` on web/desktop and
the client's own `NativeNarrationPlayer` (given track URLs) on mobile, selected
through the `resolveTracks` hook on `NarrationAudioSource`.

Consequences of that shape:

- **Marks are 1:1 with clips by construction.** Mark names are section-global par
  ordinals, so the client resolves a mark straight to its clip and there is no
  text↔audio matching anywhere in the feature.
- **The whole section plays as one continuous span.** Media Overlay clips are
  contiguous and in document order, so sequential playback needs no seeking at
  all: the element keeps rolling while boundaries are fired at par thresholds,
  and a narrated sentence or paragraph has no seam mid-way. The playhead moves
  only for a genuine discontinuity - session start, a sentence skip, a scrub, or
  a new audio file where the publisher split the recording - decided from the
  element's own position rather than from bookkeeping.
- **The scrubber is exact.** `TimelineSentence.duration` carries
  `clipEnd - clipBegin` and outranks the measured/estimated duration tiers in
  `SectionTimeline`, so a narrated chapter reports the recording's real length
  with no `~`. It is deliberately not routed through the text-keyed duration
  cache in `ttsDuration.ts`, where two identical sentences would collide.
- **Capabilities, not identity checks.** Embedded overlays report
  `{ wordBoundaries: false, textHighlight: true, mediaClock: true, gapControl: false, liveRateChange: true, continuousTimeline: true }`;
  a paired audiobook reports the same clock capabilities with
  `textHighlight: false`. `ensureTimeline`/`supportsPlaybackInfo`/`getPlaybackInfo` gate on
  `mediaClock` rather than comparing against the Edge client — which is what
  `TTSCapabilities` in `TTSClient.ts` existed for. `usesAudioTransport`
  (`mediaClock` without `textHighlight`) is what turns `forward`/`backward`
  into the time seek and audiobook-chapter skip, so the media session's
  `seekforward`/`nexttrack` handlers need no special case.
- **A continuous timeline is handed over, not stopped.** `continuousTimeline`
  tells the controller that consecutive blocks are one recording, so it neither
  pads paragraph transitions with its own delay nor treats the stop between two
  utterances of a session as a real stop. That stop passes `handover` to
  `TTSClient.stop()`, and the narration client stays rolling through it. Both
  additions to `TTSClient.ts` are optional, so the synthesizing clients
  (`NativeTTSClient`, `WebSpeechClient`, `BufferedTTSClient`) ignore them and
  behave exactly as before.

- **Page-following inside one sentence.** A sentence laid out across a page
  break gets one mark, on the page it starts on, and a phrase-timed recording
  reports no words in between — so the view used to sit still while the voice
  read the tail on the next page. `getChunkProgress()` says how far through the
  phrase the audio is; where the page stops showing the sentence is *measured*,
  not assumed, since the same sentence breaks at a different word on another
  screen or font size. `pageBreakFraction` (`utils/ttsPageFollow.ts`) bisects the
  live layout — probing characters through `getTextSubRange`, because each probe
  forces a reflow — and returns the break as a fraction of the sentence's text.
  The page turns once audio progress passes it, re-measuring after each turn so a
  sentence spanning three pages advances one page at a time. No word position is
  invented, so the highlight still follows the recording exactly. Paginated
  layout only; scrolled layout keeps its at-mark behaviour.

Selection is the existing Voice picker: `TTSController.getVoices` prepends a
narration group for books that have an embedded or paired recording, and
`setVoice` routes `MEDIA_OVERLAY_VOICE_ID` to the narration client, rebuilding
the section's mark source (the two segment differently, so the instance itself
is replaced).
`ttsUseNarration` on `TTSConfig` records the per-book opt-out; it is separate
from `ttsVoice` because `ttsVoice` inherits the global default and so cannot
distinguish "never chose" from "chose a synthetic voice for this book".

The narration data comes from foliate's EPUB parser, which already exposes
`section.mediaOverlay`, `book.media`, `book.loadText` and `book.loadBlob`;
Readest's narrowed `BookDoc`/`SectionItem` types in `src/libs/document.ts` were
widened to surface them. foliate also ships its own standalone `MediaOverlay`
player, which Readest does not use: it owns its own `<audio>` and iteration
state and highlights via the publisher's `media:active-class`, so routing
through it would bypass the scrubber, sleep timer, media session, and the
reader's own highlight style.

### Limitations

- **No `<seq>` skippability.** `epub:type="pagebreak"`/`footnote` escape is not
  implemented. The parser keeps the `<seq>` structure so it can be added without
  a rewrite.
- **`media:active-class` is ignored** on purpose — the reader's own TTS
  highlight style and colour win.
- **Chapter pre-download (Offline Audio) is Edge-only** and hidden during
  narration: the audio already ships inside the book.
- **Sub-sentence page-following needs a clock.** It is driven by
  `getChunkProgress()`, so engines without one (Web Speech) keep the old
  behaviour: a sentence straddling a page break waits for the next mark.
- **Mobile Tauri** plays narration through `NativeNarrationPlayer`: AVPlayer on
  iOS and ExoPlayer on Android. Paired audiobooks are streamed directly from
  their local path, or by `http(s)` URL for an Audiobookshelf pairing. Desktop
  Tauri streams its asset URL through `HTMLAudioElement`; web uses a blob URL.

### The library badge

A book that carries embedded narration shows a headphones badge on its library
cover.
`Book.hasNarration` is set at import time (`importBook` in
`src/services/bookService.ts`) because the library list never opens the file. It
is derived from the file on every import, like `format`, so it needs none of the
field-level LWW timestamps that user-editable book fields carry.

Consequence: **books already in the library before this shipped carry no badge
until they are re-imported.** Embedded narration itself still works on them —
only the badge is missing, because nothing has re-read the file since.

### Tests

`src/__tests__/services/tts/media-overlay-*.test.ts` covers the SMIL parser, the
section index, the mark iterator, the client (against a fake media element), and
controller-level narration selection, timeline exactness, and section skipping.
Audiobook mapping, metadata, storage, section generation, and native playback
routing are covered by the `audiobook-*`, `paired-audiobook-section`, and
`media-overlay-android-native` service tests.

`media-overlay-real-epub.test.ts` runs the real `DocumentLoader` against a real
Media Overlays book. The fixture is a ~10 MB binary and is not committed, so the
suite soft-skips without it:

```bash
curl -sLO https://github.com/IDPF/epub3-samples/releases/download/20230704/moby-dick-mo.epub
READEST_MO_EPUB=$PWD/moby-dick-mo.epub pnpm test -- media-overlay-real-epub
```

[Moby-Dick MO](https://github.com/IDPF/epub3-samples) is the canonical W3C sample
and a deliberately awkward one: chapter 1 mixes a heading par, three per-word
pars and seven per-sentence pars inside a single `<p>`, under a nested `<seq>`
carrying `epub:textref`. Only 2 of its 144 spine sections are narrated, so it
exercises gap handling too.

Verified end to end against two very different real books:

- **Moby-Dick MO** (W3C sample) — `h:mm:ss.mmm` clock values, mixed word/sentence
  granularity, audio in an `.mp4` container, 2 of 144 sections narrated.
- **A Storyteller-generated novel** — bare-seconds clocks (`1705.600s`),
  parent-relative hrefs (`../Audio/00010-00001.mp3`), 17 SMIL files, 22 MP3s in a
  330 MB container, no `media:narrator` (hence the "Book narration" fallback),
  4 unnarrated front-matter sections. Its computed chapter timeline came out at
  2966.8s against the book's declared `media:duration` of 2966.79s.
