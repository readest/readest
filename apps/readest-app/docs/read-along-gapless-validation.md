# Recorded narration: chapter handover investigation and validation

Related issue: [#6902](https://github.com/readest/readest/issues/6902).

This change prepares and queues the next recording before the current one ends,
then lets playback continue while the reader changes chapters. Android full-app
playback was tested on a BOOX Nova3 running Android 10 (API 29), with *The
Odyssey* translated by Emily Wilson and *Harry Potter and the Philosopher's
Stone (Full Cast)*. The reporter subsequently confirmed that the Android fix
works.

**The iPhone/iPad app has not been tested.** The original problem was noticed on
iOS, but Android results do not establish that it is fixed there. Apple adapter
checks on macOS and mocked iOS-path unit tests are narrower checks, not a
substitute for running the iOS reader.

## How the investigation developed

### 1. Preparing audio at the boundary was too late

The original lookahead could not prepare a different audio member while one was
already active. It also looked within the current text section, so it missed
recordings in the next narrated spine/SMIL section. The Odyssey opening advances
from Title to Introduction across several unnarrated sections.

The shared controller now finds and prepares the next narrated section without
navigating, replacing the active marks, or disturbing the current recording.
The client retains one upcoming recording. Browser playback uses a standby
clock; native adapters queue the next item in AVQueuePlayer or ExoPlayer.
An item that has already started is adopted in progress when the page catches
up, rather than being loaded or sought back to its beginning.

Pause, stop, seek, chapter-stop and sentence-step behavior still control whether
prepared audio may advance. Preparation alone must not start playback.

### 2. Large recordings exposed a mobile memory problem

The first complete BOOX reader test crashed its WebView while preparing the
Introduction recording. Android reported memory pressure; the recording was
about 47 MB. Moving a whole recording through JavaScript and the native bridge
was a likely contributor, although the renderer crash itself was not decoded
conclusively.

Embedded recordings now stream from the local EPUB to the app cache in Rust;
JavaScript passes a path to the native player. Complete cached files are reused,
incomplete files are replaced, and failed temporary writes are cleaned up. The
Blob fallback uses bounded 256 KB bridge writes. Cold-cache BOOX checks also
crossed the previous failure point successfully.

A separate large-file document-picker import failure was bypassed for these
checks by staging verified local EPUB copies in the isolated test app. This PR
does not claim to fix that import route.

### 3. Playback-position samples missed a real audible gap

Native samples showing `playing=true` on either side of a file change did not
prove uninterrupted audio. A recording of the test app's internal audio, with
no microphone capture, reproduced a roughly 65 ms silence at the Odyssey
Title → Introduction join. The reporter confirmed that it matched the problem.

The SMIL boundary rounded just beyond physical EOF. ExoPlayer clamps a message
beyond EOF to the final sample; seeking to the next item there flushes audio
that was already buffered. The adapter now leaves file-end advancement to the
playlist. The corrected Odyssey capture had no silence interval of 1 ms or
longer at that join at a -55 dB threshold.

### 4. A false buffering report reopened the player

The next block could wait for its first text mark even though the recording was
already audible. The controller reported that wait as buffering, which could
bring the hidden mini player back after 500 ms.

The client now exposes actual audio-playing state, including a queued native
item that has started before section adoption. The controller suppresses this
false buffering report while retaining the indicator for genuinely silent
loading. The final BOOX Full Cast replay kept the player hidden throughout the
handover.

Page navigation and audio continuity were measured separately. Full Cast
navigation took about 0.55–0.61 seconds in the measured first/rebuilt reader
checks and about 0.03 seconds in an already-rendered repeat. Odyssey also showed
slower initial rendering and a much faster repeat. This is not a general
optimization or guarantee for cold chapter layout.

### 5. Full Cast exposed rounding in the other direction

The Full Cast opening's SMIL ends at 63.508 seconds, while its container reports
63.509 seconds. A boundary 1 ms before EOF still triggered the seek path. A
connected-device regression reproduced `SEEK` where `AUTO` was expected.

The adapter therefore treats boundaries within 1 ms of EOF as rounded file
ends. Earlier cuts remain scheduled native cuts. The regression suite covers
rounding down, exact EOF, rounding up, and a materially earlier cut.

The final capture was compared with independently decoded source waveform
windows on both sides of the join. Both correlations exceeded 0.999999. Before
the correction, the incoming recording started 149.3 ms later than the two fully
decoded recordings joined back to back. Afterward, those anchors matched within
one 48 kHz sample.

There is still about 20 ms of quiet in the decoded AAC tail itself. The decoded
opening extends to 63.529333 seconds despite the shorter container/SMIL values.
That source tail was distinguished from the added seek delay; the contribution
does not remove pauses or padding already present in the decoded recording.

## Regression coverage

| Area | Coverage and failure caught |
| --- | --- |
| Browser standby preparation | `media-overlay-client.test.ts`: the next member is prepared while the current member plays; the original implementation created one clock instead of two. |
| Cross-section lookahead | `media-overlay-controller.test.ts`: skip unnarrated sections without navigation or changes to the current marks; speculative failures do not stop playback. |
| Handover before page work | `audio-handover.test.ts`, client tests and `media-overlay-gapless.browser.test.ts`: start the next recording before delayed section adoption and reuse it without rewind. |
| Native preparation and lifecycle | `native-narration-player.test.ts` and native client tests: queue scheduling, offsets, bounded writes, pause/stop, cancellation, cleanup, failed preparation and late completion. |
| Cache extraction | Rust EPUB parser tests: reuse a complete recording, replace an incomplete one, resolve escaped member names and reject a missing member. |
| False buffering | `tts-controller-timeline.test.ts`: a rolling recording must not report buffering while awaiting a mark; the old controller returned true. Silent loading still reports buffering. |
| Queued native state | `media-overlay-native.test.ts`: a stale stopped snapshot for the outgoing item must not hide the fact that the queued item is already audible. This is a mocked native bridge test. |
| Real Android adapter | `ContinuousNarrationQueueTest.kt`: early cut with pause/rate/offset preservation, exact EOF, EOF ±1 ms, and cancellation/seek. The rounded EOF regressions failed with transition reason 2 (`SEEK`), expected 1 (`AUTO`). |
| Apple adapter | `ios/Tests/CheckNarrationQueue.swift`: standalone AVFoundation queue checks, run on macOS. This does not test the iOS app. |

Commercial EPUBs and their audio recordings are not included in the repository.
The permanent tests use generated media and small synthetic SMIL documents.
The real-book browser and BOOX checks supplement those reproducible regressions.

## Validation scope

| Surface | Result | Limits |
| --- | --- | --- |
| Android full reader, BOOX Nova3 / API 29 | Odyssey and Full Cast opening transitions exercised; internal-audio captures compared with sources; player visibility monitored; reporter confirmed the fix. | One Android device. This does not establish coverage for every Android version, route or background condition. |
| Android native adapter | Connected instrumentation tests passed, including both rounding directions and lifecycle behavior. | Adapter tests complement the full-reader checks. |
| Browser | Real Chromium decoding/standby handover and a local Full Cast opening check passed. | Browser checks are not iOS WebKit or a packaged desktop app check. |
| Apple adapter on macOS | Standalone AVFoundation checks passed. | No complete macOS reader listening claim. |
| iPhone/iPad full app | **Not run.** | Device playback, background/lock-screen continuity, interruptions and audio-route changes remain to be checked. |

The full Android recordings and reporter confirmation apply to implementation
commit `1b8a1e56d`. After integrating upstream main `2d37bbfc2`, the reader was
rebuilt, installed and replayed through the complete Full Cast opening on the
same BOOX. Playback advanced into Chapter 1, the player remained hidden and
chapter navigation took about 0.53 seconds. This was a fresh full-reader playback
check, not another acoustic capture; the earlier waveform measurements are not
attributed to the integrated revision.

Automated checks after integration passed: 13,780 JavaScript tests (16 skipped),
191 Rust tests, TypeScript/Biome, Rust formatting/clippy, the Chromium handover
regression, all five connected Android adapter tests, all three standalone macOS
AVFoundation checks, the frontend production export and the Android APK build.
The first expanded Android test build encountered duplicate generated DEX files
before any tests ran; rebuilding in a fresh output directory passed all five.

## Reproducing the checks

From `apps/readest-app`, run the service regressions and the real Chromium
handover check:

```sh
pnpm test --run src/__tests__/services/tts-controller-timeline.test.ts src/__tests__/services/tts/
pnpm test:browser src/__tests__/services/tts/media-overlay-gapless.browser.test.ts
```

Run the native-tts module's `connectedDebugAndroidTest` task in an Android test
project, rather than the root task that also installs unrelated library runners.
The standalone Apple check is documented in [Read-along narration](read-along-narration.md#native-queue-checks).

For a real-book check, start from the beginning of the narrated opening, allow
the next recording to prepare, and let the chapter advance without intervening
controls. Repeat after clearing only the extracted-audio cache. Check actual
audio, chapter navigation and mini-player visibility separately. Compare any
suspected silence with decoded source audio; periodic position samples alone
cannot validate a gapless join.
