## Read-Along Narration (EPUB 3 Media Overlays)

When a book ships with a recorded human narration, Readest plays that recording
instead of synthesizing speech — while keeping everything else Read Aloud
already does: the moving highlight, page-following, sentence/paragraph skip, the
scrubber and seek, speed, sleep timer, lock-screen and CarPlay controls, and
background sessions.

### Prior art

Synchronized read-along is a feature the major ecosystems have converged on:

- **Kindle Immersion Reading** — Kindle text highlighted in step with an Audible
  narration, via Amazon's Whispersync for Voice pairing.
- **Audible Read & Listen** (launched February 2026) — the same thing inside the
  Audible app, with word-level highlighting as the narrator speaks. Requires
  owning both the Audible audiobook *and* the matching Kindle ebook.
- **Spotify** is working the same problem from a different angle: **Follow Along**
  syncs time-stamped illustrations and graphics to the narration, and **Page
  Match** uses OCR on a photographed page to jump the audiobook to that spot (and
  shows the page number matching the current audio position). Position matching
  and companion media rather than synchronized text highlighting — adjacent, not
  equivalent.

Readest's version is the Kindle/Audible experience built on the **open EPUB
standard** rather than a store-side pairing of two purchases. It needs no account
and no matching entitlements: any narrated EPUB you own or generate plays, on
every platform Readest runs on.

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

Readest deliberately does **not** do the alignment itself. Dropping a bare MP3
next to a book gives no timings, and inventing them would mean shipping a
speech-recognition model. Alignment is a separate, one-time, offline job; tools
like Storyteller already do it well.

### Using it

1. Import the narrated EPUB as usual.
2. Open **Read Aloud**. For a book that carries narration, the narrator is
   selected automatically and appears at the top of the **Voice** list (named
   from the EPUB's `media:narrator` metadata, or "Book narration" when the book
   declares none).
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

Everything lives in `src/services/tts/mediaOverlay/`:

| File | Role |
| --- | --- |
| `parseSmil.ts` | Pure SMIL parsing: `parseSmilClock` (SMIL clock values) and `parseSmil` (walks `<body>`/`<seq>`/`<par>` in document order, resolving hrefs against the SMIL file). |
| `MediaOverlaySection.ts` | Per-section index: resolves each par's text fragment to a DOM `Range` in the section document, groups pars into blocks by nearest block-level ancestor, and builds the SSML the controller consumes. |
| `MediaOverlayTTS.ts` | Stands in for foliate's `TTS`. Same navigation surface (`start`/`resume`/`next`/`prev`/`nextMark`/`prevMark`/`from`/`setMark`/`getLastRange`), but marks come from the par list. |
| `MediaOverlayClient.ts` | `implements TTSClient`. Plays clips off one `HTMLMediaElement`, emitting a `boundary` as each par becomes audible. |

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
- **Capabilities, not identity checks.** The client reports
  `{ wordBoundaries: false, mediaClock: true, gapControl: false, liveRateChange: true, continuousTimeline: true }`,
  and `ensureTimeline`/`supportsPlaybackInfo`/`getPlaybackInfo` gate on
  `mediaClock` rather than comparing against the Edge client — which is what
  `TTSCapabilities` in `TTSClient.ts` existed for.
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
narration group for books that have overlays, and `setVoice` routes
`MEDIA_OVERLAY_VOICE_ID` to the narration client, rebuilding the section's mark
source (the two segment differently, so the instance itself is replaced).
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
- **iOS Tauri** plays narration through the same in-process AVPlayer as Edge
  TTS (`NativeNarrationPlayer` → native-tts `playout` load/seek). A plain
  `HTMLMediaElement` is interrupted when the media session claims the app's
  non-mixable `.playback` session; web / Android / desktop keep using
  `HTMLAudioElement`.

### The library badge

A book that carries narration shows a headphones badge on its library cover.
`Book.hasNarration` is set at import time (`importBook` in
`src/services/bookService.ts`) because the library list never opens the file. It
is derived from the file on every import, like `format`, so it needs none of the
field-level LWW timestamps that user-editable book fields carry.

Consequence: **books already in the library before this shipped carry no badge
until they are re-imported.** Narration itself still works on them — only the
badge is missing, because nothing has re-read the file since.

### Tests

`src/__tests__/services/tts/media-overlay-*.test.ts` covers the SMIL parser, the
section index, the mark iterator, the client (against a fake media element), and
controller-level narration selection, timeline exactness, and section skipping.

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
