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

### Does reading while listening actually help?

Worth stating plainly, because the marketing around these features tends to
overclaim: **the research does not support "read + listen" as a general
comprehension or retention booster.** Two findings frame it:

- Rogowsky, Calhoun & Tallal (2016) randomly assigned 91 adults to e-text,
  audiobook, or **both simultaneously**, then tested comprehension immediately
  and after two weeks. No statistically significant difference between the three
  conditions at either point —
  [*Does Modality Matter?*, SAGE Open 6(3)](https://journals.sagepub.com/doi/10.1177/2158244016669550).
- Clinton-Lisell's meta-analysis of 30 studies (N = 1,945, 62 effect sizes) found
  a **trivial** overall benefit of reading-while-listening over reading alone
  (g = 0.18). The interesting split is pacing: **g = 0.41 when reading was
  externally paced, g = 0.06 when self-paced** —
  [*Does Reading While Listening to Text Improve Comprehension Compared to
  Reading Only?*, Educational Research: Theory and Practice 34(3),
  2023](https://eric.ed.gov/?id=EJ1403866).

That pacing split is the one result with a direct bearing here: narration-driven
playback *is* externally paced reading — the recording sets the rate and the
highlight keeps the eye on it — which is the condition where the benefit showed
up. Suggestive, not established; none of those studies tested Media Overlays.

Where gains are better supported is narrower and more specific: **struggling and
developing readers**' comprehension, and **second-language learners**' incidental
vocabulary acquisition (both flagged in the same meta-analysis, with the authors
explicitly noting the evidence base is too thin to generalise). Cognitive load
theory pushes the other way via the **redundancy effect** — identical spoken and
written text can compete rather than reinforce, most of all for readers not yet
fluent in the language on the page.

So the feature is built as a **preference, not a prescription**: when a book
carries narration it is used by default (a human reading is the better rendition
of that book either way), and one tap in the Voice list turns it off per book. No
claim is made that it makes anyone read better.

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
- **Blocks play as one continuous span.** Consecutive pars in a paragraph are
  contiguous audio; the client seeks once at the block start and fires
  boundaries at par thresholds, so a narrated sentence has no seam mid-way.
  It re-seeks only where the publisher split a paragraph across audio files.
- **The scrubber is exact.** `TimelineSentence.duration` carries
  `clipEnd - clipBegin` and outranks the measured/estimated duration tiers in
  `SectionTimeline`, so a narrated chapter reports the recording's real length
  with no `~`. It is deliberately not routed through the text-keyed duration
  cache in `ttsDuration.ts`, where two identical sentences would collide.
- **Capabilities, not identity checks.** The client reports
  `{ wordBoundaries: false, mediaClock: true, gapControl: false, liveRateChange: true }`,
  and `ensureTimeline`/`supportsPlaybackInfo`/`getPlaybackInfo` gate on
  `mediaClock` rather than comparing against the Edge client — which is what
  `TTSCapabilities` in `TTSClient.ts` existed for.

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
- **iOS Tauri is unverified.** The client uses a plain `HTMLMediaElement`, which
  is better placed there than WebAudio (see the header comment in
  `TTSAudioPlayer.ts` on audio-session ownership), but Now Playing may not
  surface correctly. A native-player path would be a follow-up.

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

### Bugs the unit tests could not have found

Four defects surfaced only when the feature was driven end to end in a browser
against those books. They are worth knowing about, because each is invisible to a
jsdom test:

1. **The highlight never painted.** Par ranges were built with
   `selectNodeContents(el)`, which puts both boundaries on the *element*.
   foliate's `getCFI` then emits a degenerate range CFI whose start and end paths
   are identical (`...,/10[c01p0004],/10[c01p0004])`), and since the highlighter
   round-trips every range through a CFI before drawing, it re-anchored to
   nothing. Ranges must be anchored inside text nodes, as foliate's own text
   walker produces (`textRangeOf` in `MediaOverlaySection.ts`).
2. **The audio would not decode.** Blobs come out of the EPUB container with an
   empty MIME type, and a media element given a typeless blob URL fails with
   `MEDIA_ELEMENT_ERROR: Format error`. The type is now supplied from the file
   extension (`AUDIO_MIME_TYPES` in `MediaOverlayClient.ts`).
3. **The same 9 MB file loaded five times at once.** `preloadNextSSML(4)` and
   playback all requested the chapter audio before any load finished, so each
   built its own element — and each one's release revoked the previous URL
   mid-load. `#ensureAudio` now shares one in-flight load per href.
4. **`WrongDocumentError` killed the session before a note sounded.** Skipping
   unnarrated sections means the location playback was requested *from* usually
   belongs to a different section's document than the one we land on, and
   `compareBoundaryPoints` throws across documents. `from()` now detects a
   foreign range and starts at the top of the section instead. This only ever
   fired on a book whose first sections are unnarrated — which the W3C sample is
   not, and every Storyteller output is.

A fourth, pre-existing, turned up alongside them: `WebSpeechClient.init()` waited
forever for a `voiceschanged` event on a platform reporting zero speech voices,
which wedged `TTSController.init()` and so blocked *every* engine — including
narration, which needs no system voice at all. It now gives up after a timeout.
