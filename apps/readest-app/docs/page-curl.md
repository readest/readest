# Paper page turn

## Visible frames under GPU delay and a clamped first-page turn

Queued inputs reached `animate`, but its clock could expire while GL work was
blocked. Coalesced draws then rendered only the latest/final pose. Settlement
now submits one pose at a time and waits for TextureView's hardware layer to
acquire its timestamped image before scheduling the next pose. The elapsed step
is capped at one sixth of the existing 100ms minimum, so a stalled frame cannot
consume every intermediate pose. Finger-follow drawing keeps its coalesced path;
this does not read back pixels or transfer images through JS during animation.

Each native frame carries an EGL presentation timestamp. A hardware frame-commit
callback checks the acquired SurfaceTexture timestamp; if RenderThread is still
behind, the check resumes on a later vsync. `onSurfaceTextureUpdated` alone was
insufficient: a probe observed the preceding timestamp in that Java callback.
This uses the documented EGL producer timestamp semantics in
[SurfaceTexture.getTimestamp](https://developer.android.com/reference/android/graphics/SurfaceTexture#getTimestamp()).
An immutable per-request callback identity prevents a cancelled old submission
from acknowledging the replacement frame. Final frames use the same acquisition
check before the existing WebView handoff fences.

The regression blocks GL for 200ms and observes actual TextureView bitmap colours
for three consecutive forward/backward turns. It previously observed no curved
image for a tap; it now requires multiple curved images for every turn. Another
test cancels an unpresented frame, then verifies the following turn remains usable.
The next pose is submitted directly from the acquisition acknowledgement rather
than waiting another Choreographer tick; final pacing was rerun through all 16
instrumented tests and 22 JVM tests successfully.

Cold navigation at the first page can be clamped without changing its page key.
That no-op no longer creates a fictitious previous sheet or marks the scene as
having navigated (which could make cancellation incorrectly navigate forwards).
Tests cover both commit and cancellation followed by a valid forward turn. A
360px real EPUB test also checks repeated backward attempts during warm-up and
subsequent forward navigation without reverting after the scroll debounce.

Validation: 16 API 33 instrumented tests, 22 Android JVM tests, 110 targeted JS
tests and 156 Chromium tests pass. TypeScript/Biome lint and production export
pass. Full-unit attempts remain non-green: the earlier attempt hits the known
60-second TTS timeout (528 passed); the final bail=1 attempt hits the existing
5-second settings-reset timeout (75 passed, 6 skipped). No Redmi 12 / Android 15
physical display or input-latency measurement was available.
The settings-reset file passes all 5 tests when rerun separately. The build
environment's 774 missing Cargo source trees were restored from local archives
(lock-file package checksums verified), retaining the earlier local turso_ext
Android cross-build workaround without changing dependency versions.

APK: `target/artifacts/Readest-pagecurl-visibleframes-arm64-debug.apk`
(227,449,205 bytes), SHA-256
`3226a01fdbf1df5b1df4c957806ab5a3a1e2961554753aacea937e65da2ef416`.
ZIP integrity, 16 KiB alignment and v2/v3 signatures pass; the previous debug
certificate is retained. Actual DEX inspection verifies timestamped rendering,
acquired-frame acknowledgement, directly paced subsequent poses and both
idle/finish handoff fences. Updated frontend chunk identities are present in
the embedded native library. The isolated test emulator was stopped.

## Repeated taps and immediate following swipes

The native controller used to return false for another programmatic turn while
its previous session/scene was active. A separate hook gate also rejected the
entire touch sequence if it started during a tap turn. Native taps now enqueue
their begin/end pair synchronously; following taps and swipes retain their order.
The hook and iframe programmatic-touch gate remain in effect for other captured
renderers, while eligible Android native curl accepts the next gesture. Queued
turns recheck the current book boundary before starting.

Native `complete` previously latched a request that could skip an animation
before it even began, or snap an active animation directly to its final pose.
It now accelerates settlement to the existing 100ms minimum without bypassing
the frame callback. A backlog also requests that accelerated tail when the
preceding scene is still preparing. The completed page stays covered through
the existing finish/idle presentation fences; geometry and texture quality do
not change.

Regression tests first reproduced dropped burst taps, a swipe rejected during
a tap, missing completion requests for already queued input, a stale boundary,
and a native animation skipped by an early completion. Validation: 108 page-turn
JS tests plus 5 settings tests pass, as do 155 Chromium tests, 22 Android JVM
tests and 14 API 33 instrumented tests. TypeScript/Biome lint passes. The full
unit attempt with bail=1 stops on the previously observed 5-second
`ControlPanelUpdateReset` timeout (34 passed, 6 skipped); all 5 tests in that file
pass in the targeted rerun. Redmi 12 / Android 15 input latency remains unmeasured.

APK: `target/artifacts/Readest-pagecurl-inputfix-arm64-debug.apk` (227,469,685
bytes), SHA-256 `a6e37bcdd6fb4097dc26597cdcbff2dea8c42975e5c759658afeb4e59c9a857e`.
Production export, APK ZIP integrity, 16 KiB alignment and v2/v3 signatures pass;
the debug certificate matches the prior APK. Packaged DEX checks confirm the
accelerated frame callback, absence of the old touch-triggered snap and retained
idle/finish presentation fences. The updated native-input frontend chunk names
were verified inside the embedded library. The test emulator was stopped.

## Flash after a smooth native turn

Neighbour preparation restores the live paginator before sending `idle`, but
two JavaScript animation frames do not fence Android WebView presentation.
Unlike `finish`, `idle` previously lowered the native cover immediately and
could reveal the last preview (often the previous page) before restoration
reached the window. `idle` now uses the same visual-state/frame-commit barrier
as `finish`, retaining the cover until the restored WebView frame is committed.
Its callback also checks that a newer turn has not taken ownership.

The Android regression holds WebView presentation while the live window still
contains a different neighbour. Before the fix it fails with cover alpha 0.004
instead of 1; after the fix the cover and pending command remain until the
restored page is ready. Curl geometry, touch tracking and timing are unchanged.

Validation: 13 API 33 instrumented tests, 22 Android JVM tests, 105 targeted JS
tests and TypeScript/Biome lint pass. The full JS attempt again reports the
existing 60-second TTS paragraph-boundary timeout. The handset report is Android
15; that physical device was not available for testing.

APK: `target/artifacts/Readest-pagecurl-handoff-arm64-debug.apk` (227,449,205
bytes), SHA-256 `e0e901716fdb03abeab8b834d6fc2d14ed74f3a30bca0c2db8cf7e1ac6cedff5`.
ZIP integrity, 16 KiB alignment and v2/v3 signatures pass; the certificate matches
the preceding APK. Inspection of the packaged DEX verifies both `idle` and
`finish` invoke the presentation barrier. The production frontend is unchanged
and its chunk identities were verified in the embedded native library.

## Rapid swipe lifecycle corrections

The initial native tests did not exercise a new touch between the animation's
completion and the live-page handoff. That gap let a completed leaf accept the
next finger's movement and reopen the old page. Dragging and holding a landed
frame are now separate states; release/cancel stops touch updates, and the landed
frame remains frozen until the live navigation completes and Android presents it.

Every gesture now supplies a turn ID for start/move/animate/complete/cancel/finish.
An old command, including an asynchronous finish callback, cannot change the next
turn. This complements the stable current/destination page identities verified
in eBoox's `bb1`/`vi2` renderer, where the selected bitmap pair is retained together.

Native navigation awaits the actual paginator promise instead of exposing a
page on an early CFI relocation. Hiding a toolbar outside the native EPUB sheet
does not discard that sheet's textures. A native interruption no longer sets the
process-wide `captureBroken` flag: it releases the failed session, invalidates its
texture bank, waits for invalidation acknowledgement and permits the next gesture.
Failed start promises also clear their session so programmatic turns can retry.

JavaScript explicitly reports whether a gesture ended before the native start.
A buffered completed flick begins with a visible partial leaf (progress capped
at 0.5), rather than starting at an empty 100% pose. A missing native ACTION_DOWN
is handled separately: JS movement continues to drive that gesture. Settlement
must continue from the native visible pose rather than jumping to a queued release
sample before animating. Tests cover both sides of that distinction.

Rapid-swipe validation: 105 targeted JS unit tests, 155 Chromium browser tests,
22 Android JVM tests and 12 API 33 instrumented tests pass. Each new reported
failure pattern was reproduced before its fix: early native handoff, process-wide
animation disable, a stranded programmatic session, toolbar cache destruction,
reopening a completed leaf with the next finger, an old finish hiding a new
turn, an empty initial fast-flick pose, missing-DOWN fallback movement, and a
queued release jumping settlement from 0.4 to 1.0. The prior tests only initiated
the next touch after finish; the added tests also enter the handoff interval.

TypeScript, Biome lint, production frontend export, Rust formatting and strict
native-plugin Clippy pass. The final full JS unit attempt is not green: it stops
on the previously observed 60-second TTS paragraph-boundary timeout (345 passed,
36 skipped). An earlier concurrent attempt also timed out in `document/tts.test.ts`;
all 51 tests in that file passed when rerun separately with the turn checks.
The earlier Windows Rust baseline failures below remain outside this change.
No Redmi 12 / Android 15 frame-pacing measurement was available.

Final rapid-swipe APK:
`target/artifacts/Readest-pagecurl-rapidfix-arm64-debug.apk` (227,457,397 bytes),
SHA-256 `ee7adf16f3e44d1dfe3e33b03adf236cef219bb733d4db3e90a42996b679e5d9`.
ZIP integrity, 16 KiB alignment and v2/v3 signatures pass. The APK's DEX was
checked for the actual `released` reads, turn identity and absence of the old
release-progress jump in `animate`; the final frontend chunk identities were
also found in the embedded native library. The debug certificate matches the
previous APK, so this is an update of the same package. The isolated emulator
was stopped after the final tests.

## Native Android pipeline

Android single-column horizontal EPUB curl now uses `NativePageTurn` and the
native `NativePaperTurn`/`NativePaperView` renderer. Current and neighbouring
pages are captured losslessly at physical pixel resolution by Android PixelCopy
and uploaded directly from Bitmap to resident ES2 textures (maximum three).
No image bytes, JPEG, Base64 or decoded JS bitmap cross the page-turn bridge.
The reference APK's `i6` page objects hold Bitmaps and its `vi2` renderer uploads
them with GLUtils; this ready-bitmap-to-GL architecture is the verified reference.
Readest still produces book layout in its WebView: this is not eBoox's layout
engine, and its bitmap-production implementation was not fully established.

Android tracks MotionEvents and schedules animation with Choreographer on a
dedicated EGL rendering thread. JavaScript supplies page identities and commits
reading position after animation. The native cover remains until WebView visual
state and a committed Activity frame confirm the destination. Cancellation of a
resident sheet does not navigate. A new gesture completes the previous animation
tail without exposing an old live page. Cold section changes are prepared under
the current sheet and roll back once if cancelled. Native commits skip the
paginator's legacy 100 ms delay; other modes retain their existing behavior.

The mesh storage is reused. Projected triangles carry their own paper-side bit
instead of relying on Android driver `gl_FrontFacing`. Flat sheets use nearest
pixel sampling, moving folds use linear interpolation, and shaders use highp
coordinates where supported. The native view disables a second system force-dark
pass because captured pixels already contain the reader's final colours.
Capture cancellation waits for queued texture removal before restoring/reusing
page identities. Theme/layout changes, backgrounding and owner changes invalidate
the native cache. Timeout/error paths dismiss the native cover and discard JS
texture identities so a later gesture can create fresh native resources.

Other platforms and unsupported reading modes retain the captured WebGL path
described below. Native timing on the Redmi 12 remains unmeasured; emulator tests
are functional checks, not a claim of matching physical-device frame pacing.

Initial native validation (2026-10-22): 99 targeted web unit tests, 155 Chromium browser
tests, 22 Android JVM tests (including five mesh tests), and seven instrumented
tests on an API 33 emulator passed. Instrumented checks cover native touch,
forward/backward presentation, eight rapid animation-tail completions, full-height
single-pixel detail, cancellation before/during/after capture, and the bounded
texture bank. The native plugin passes strict Clippy; Rust formatting, TypeScript,
Biome lint (one informational suggestion) and the production frontend build pass.

The complete suites are not green: the web run stopped on the existing 60-second
TTS paragraph-boundary timeout (434 passed, nine skipped). Windows Rust tests
report 186 passed and two failures in `dir_scanner::scan_preserves_requested_root_spelling`
and `range_file::safe_path_accepts_absolute_traversal_free`, both concerning path
handling. Strict app-wide Clippy is blocked by three warnings-as-errors in the
nested Windows thumbnail crate. These files were not changed for page turns.

The initial native ARM64 APK is `target/artifacts/Readest-pagecurl-native-arm64-debug.apk`
(227,457,397 bytes), SHA-256
`41321213380bfae15dafa08fb783d5107d7f6d9d713dea86fdf170a5e43bee32`.
ZIP integrity, 16 KiB alignment, v2/v3 signatures, renderer classes, Rust command,
and current embedded frontend chunk identities were verified. It uses the same
debug certificate as the preceding test APKs. The isolated emulator was stopped
after the checks. Physical Redmi 12 / Android 15 playback remains unverified.

The curl renderer uses a strip mesh instead of the previous rectangular grid
wrapped around a cylinder. `src/utils/pageCurlMesh.ts` clips the captured leaf
at each hinge, then deforms the resulting triangles. The texture coordinates
stay attached to the original paper. The existing captured-turn controller
still handles capture, navigation, cancellation and release timing.

## APK reference

The supplied eBoox 2.63 (88) APK was inspected locally with Androguard DAD.
Its SHA-256 is
`630cb2031bb473001b7d66ff188de4034155d2d683a5491cfb59d8d99b1bc90d`.
`com.reader.books.gui.views.reader.horizontal.PageCurlGLSurface` delegates to
the obfuscated `vi2` renderer in `classes.dex`; `bb1` supplies the horizontal
position and vertical finger displacement. No APK binaries or decompiled
sources are included in Readest.

The reference's active rendering mode (`f = 1`) supplies these parameters:

| Parameter | Value |
| --- | --- |
| Hinges / rotation per hinge | 64 / π÷65 radians |
| Bend band | 0.7 × leaf width |
| Projection factor | 7 |
| Stationary vertical bias | 0.1 × page height |
| Back-face tint | 40% neutral grey, 60% captured printing |
| Bend tint | triangular profile, maximum 0.25 |
| Edge tint | 0.4, within 2 logical pixels when lift exceeds 10 |

The implementation expresses the successive hinge rotations as a trigonometric
sum, then uses WebGL for perspective-correct texture interpolation and depth.
It retains the incoming-page texture on the back of a two-column leaf.

Backward navigation keeps the book's spine and reverses the deformation of
the previous sheet. It does not switch to RTL. The current capture remains
underneath until the previous sheet covers it; on spreads the current inner
column is also used on the back of the returning leaf. Android freezes the
visible pixels in a separate PopupWindow while PixelCopy captures the activity
window underneath. iOS uses its existing native cover. Desktop hosts without
a native cover hide the outgoing overlay during the previous-page capture.

## Integration differences

Readest's normalized progress starts with an exactly flat page and ends with a
cleared single page. The fold centre follows the reference without the added
half-height offset that previously reduced the corner on tall screens.
On a two-column spread the bend tapers to zero so the incoming page
lands exactly at the spine. Release easing and duration remain controlled by
Readest. These adaptations mean this is not a verified pixel-for-pixel or
timing-equivalent reproduction of the Android application.

## Verification

The new back-face pixel test failed against the old renderer (red channel 169,
expected below 130). The updated renderer passes the page-curl, captured-turn
and turn-backdrop browser suites (107 tests), plus geometry tests that check
complete source coverage across phone/tablet dimensions, both directions and
one/two columns. TypeScript and Biome pass. Android side-by-side playback has
not been verified.

After preparing the generated PDF.js worker, the full unit run reported 13,875
passing tests and one 60-second TTS paragraph-boundary timeout. That TTS code was
not changed.

## Local Android build

### Startup latency

The captured navigation wrapper now resumes on the paginator's `page`
relocation, after its destination offset and backgrounds have been updated,
instead of waiting for its subsequent 100ms unlock timer. The underlying
navigation promise still serializes subsequent navigation, including drag
cancellation; fixed-layout and section transitions without that relocation
continue to await normal completion. A hook regression test failed before
the change because rendering readiness remained false until unlock. Tests
also cover cancellation serialization, unrelated relocations, and errors.

The controller no longer loads or awaits a separate theme backdrop that the
neutral eBoox-style material does not use. The pixel test verifies both that
the material is unchanged and the unused host callback is never invoked.
Cold native capture and the previous-sheet capture for backward turns still
require asynchronous native work. These changes remove confirmed startup
waits; identical touch latency to eBoox has not been measured on a device.
The latency build passes 91 targeted hook/geometry tests, 111 browser tests,
TypeScript/Biome, and the production frontend build. Its ARM64 debug APK is
repacked after `llvm-strip --strip-debug`, aligned for 16KiB native libraries,
and signed with the same local debug key. APK signature, ZIP integrity,
alignment, and unchanged resources are verified; its size is about 217 MiB.

### Repeated gestures and frame handoff

A following drag finishes a committed sheet's remaining animation immediately;
it does not interrupt a cancellation that must restore the original page.
Gestures buffered during capture still navigate once each but skip obsolete
animation tails while newer gestures wait. The regression with a five-second
settle failed before the change because the next swipe could not start within
500ms. The four-buffered-gesture and cancellation tests also pass.

GPU context loss is deferred until the removed canvas layer has passed a paint.
Previously the context was cleared before its DOM layer was removed, allowing
the compositor to display a cleared intermediate frame. A real WebGL test fails
against the old immediate loss and passes with the delayed release. Actual
Android flicker and end-to-end input latency still need device verification.

The upper-corner regression on a 400×800 sheet previously found its first
lifted top-edge vertex at x≈359 instead of the reference x≈299. Removing the
extra half-height fold offset fixes it. The reference rotation constant is
0.0483321946706122 (π/65), not π/64.

The latest full-unit attempt used `--maxWorkers=4 --bail=1` and stopped on the
existing 60-second TTS paragraph-boundary timeout: 1,585 tests passed before
that failure. It is not a passing full-suite result; unrelated TTS code and
test expectations were not changed.

### Backward page identity and native capture readiness

Early navigation readiness now requires a changed CFI as well as a `page`
relocation. A same-page or clamped relocation is not sufficient evidence
that the destination is ready. A test injecting such an event during pending
navigation failed before this guard (`acceptedOldPage` was true) and passes
afterward. This establishes the readiness guard's behavior, not the cause of
the device report. Unknown or unchanged locations await normal completion.

Android capture also waits for `WebView.postVisualStateCallback` and, on
hardware-accelerated Android 10+, a frame-commit callback before PixelCopy.
Older Android waits through a draw after visual readiness. A two-second
deadline rejects missing frames instead of leaving a native capture pending.
This addresses a separate native stale-frame risk; no Android device was
available to reproduce or verify that race. Kotlin compilation and APK build
pass. The browser controller test reads the previous page's blue pixels on
the terminal frame before overlay removal; it cannot validate PixelCopy.

### GPU work and frame pacing

The controller retains one detached Curl surface process-wide between turns.
It reuses shaders, framebuffer and texture objects only for matching geometry
and render scale, uploads the freshly captured page before reveal, and releases
the recycled context when its owning reader is disposed. An in-flight incoming
capture prevents recycling that surface. A new regression failed on the former
per-turn canvas allocation and now verifies both context identity and new blue
page pixels. Another test checks that reader disposal releases the context.

The framebuffer scale is limited to the captured bitmap's actual pixels per
logical page pixel. A 2x mobile snapshot no longer fills a 2.75x framebuffer:
390x844 becomes 780x1688 instead of 1073x2321, about 47% fewer raster pixels.
The texture object's storage is updated instead of allocating another texture
object for each page. Both allocation regressions failed before the changes.
The paper geometry, material and antialiasing are unchanged.

Curl touch samples are coalesced at requestAnimationFrame. A burst of ten input
samples now renders the latest pose once instead of submitting ten meshes before
the next paint. Release flushes the latest position and cancels the pending input
frame; settling already uses RAF. Slide and push input behavior is unchanged.
The burst regression failed with ten immediate renders before this change.
Android also recycles each native capture bitmap after JPEG/base64 encoding,
including failure paths, rather than leaving full-screen pixels to eventual GC.

Component measurements in headless Chromium/SwiftShader, not Redmi 12 results:

| Measurement | Cold/new context | Reused context |
| --- | --- | --- |
| Contexts across 12 turns | 12 | 1 |
| Median setup | 11.5 ms | 0.7 ms |
| Maximum setup in this small sample | 17.2 ms | 25.2 ms |

The cold first setup/outlier remains. Native Android snapshot/encoding is mocked
in that setup measurement. A separate synchronous raster microbenchmark measured
0.6→0.4 ms median at the framebuffer sizes above, with p95 unchanged at 1.2 ms.
These are component costs, not app FPS or an end-to-end phone latency claim.
Mesh generation measured 0.119 ms median (0.168 ms p95) and was not rewritten.
Hardware frame traces and comparison with eBoox on Redmi 12 remain outstanding;
cold capture still requires native snapshot and encoding work.

GPU optimization validation: 117 browser tests and 92 targeted hook/geometry
tests pass, along with TypeScript/Biome and production/frontend plus Android
builds. The full unit attempt with bail-on-first-failure stopped on the existing
5-second ControlPanelUpdateReset timeout (6 tests passed); an isolated retry of
that file passed all 5 tests. This is still not a passing full-unit result.

### Buffered neighbouring EPUB sheets

The mobile single-column horizontal EPUB curl now prepares the current,
previous and next page ahead of a gesture. `PageTurnBuffer` keeps at most
three decoded pages, with one buffer owner across reader cells. A page key
contains the paginator unit and local page; prepending loaded sections does
not change it. Layout, theme, annotation, chrome and reader-state changes
invalidate pixels; ordinary relocation preserves the small rolling cache.

The paginator's `previewPage` API temporarily renders an already loaded
neighbour under a native cover without emitting relocate/scroll events or
writing reading progress. It restores the viewport on success, failure and
gesture abort. Navigation waits for restoration. Unloaded sections use the
normal path. These changes include `packages/foliate-js/paginator.js`, a Git
submodule: an upstream contribution must include that dependency change,
not only the Readest source files.

Both neighbouring textures are uploaded while idle. Selecting a ready sheet
does not capture, decode or upload a texture during the gesture. A ready
forward destination is drawn underneath the curling current page, so movement
can begin before the underlying live navigation resolves. A ready previous
sheet uses the fixed-spine return directly. App counters and controls remain
live outside the buffered book rectangle, avoiding stale page counters in
speculative snapshots.

This implements pre-prepared pages while retaining Readest's EPUB/WebView
engine, as requested. It does not replace it with eBoox's native layout or
OpenGL renderer. Native PixelCopy/JPEG/bridge work still prepares missing
pages outside the gesture, and a cold/missing/invalidated neighbour can fall
back to capture. Fixed layout, vertical writing, spreads and platforms without
a native cover retain their existing path. Redmi 12 latency and frame pacing
still need device verification.

Buffer validation: 154 browser tests passed across controller, material,
decoded-page buffer, paginator and resize suites; 92 targeted hook/mesh unit
tests passed. TypeScript and scoped Biome checks passed. The full-unit attempt
again stopped on `ControlPanelUpdateReset`'s 5-second timeout; that file passed
all 5 tests when rerun alone. The full suite is not green.

### Cancellation and layout work during motion

A slow-encoder regression reproduced a remaining lock: abort restored the
viewport but the paginator still awaited `capture()` before releasing navigation.
The preview now races capture against cancellation and releases after the restored
viewport paints, without waiting for obsolete JPEG/bridge work. Late results are
discarded before decoding. The regression failed with an unresolved snapshot
and passes when navigation can finish before that snapshot resolves.

For resident neighbouring sheets, live EPUB navigation is deferred until the
curl reaches its destination. Cancelling that gesture performs no live page
navigation. A new swipe can finish the moving sheet immediately but keeps its
destination cover until the deferred navigation paints. Cold/missing-sheet
paths retain the existing choreography.

An explicitly instrumented build can set
`NEXT_PUBLIC_PAGE_CURL_DIAGNOSTICS=1`. Its `curl-timing-2` overlay reports whether
the scene was resident, time from gesture claim to first nonzero draw submission,
and RAF intervals during motion. These are JS timings, not physical display FPS
or GPU-present timestamps. Normal builds do not show the overlay. Frame pacing
on Redmi 12 is still unverified; structural tests are not phone measurements.

Cancellation/deferred-commit validation: 157 browser tests and 94 targeted
unit tests (including the diagnostic timing calculations) passed, along with
TypeScript and scoped Biome checks. The full-unit attempt stopped after 555
passing tests on the previously observed 60-second TTS paragraph-boundary
timeout; it is not a green full-suite result.

An ARM64 debug APK was built with the production frontend export. APK signature
verification passed. No physical Android device was available for playback tests.
The initial debug APK contains native debug symbols and is approximately
718 MiB; the later latency build removes those symbols as described above.

This Windows environment required isolated temporary Rust and Windows SDK tools.
The cached turso_ext 0.6.1 build script was patched locally to check
`CARGO_CFG_TARGET_OS` instead of the build host's `cfg!(target_os)` before linking
advapi32; otherwise it incorrectly links a Windows library into Android. The
dependency version and lockfile remain unchanged. Generated Android build files
use Kotlin 2.2.10 with incremental compilation disabled to avoid cross-drive
cache failures. A nonexistent `jdk.net.unixdomain.tmpdir` forces the installed
JDK's broken Unix-domain socket path to fall back to TCP for Gradle.
