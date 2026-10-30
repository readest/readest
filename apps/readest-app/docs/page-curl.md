# Paper page turns

Readest renders a captured page as a deformable strip mesh. The book continues
to use its existing layout engine; the animation temporarily covers that layout
until the destination page is ready.

## Native path (Android and iOS)

Horizontal content with Curl enabled uses `NativePageTurn` in JavaScript and
`NativePaperTurn` / `NativePaperView` on Android and iOS: reflowable books in one or two
columns, and fixed layouts (PDF, CBZ, fixed EPUB) in single pages or two-page
spreads. A two-column spread turns its outer column as a leaf hinged at the
spine; the leaf's back shows the destination spread's facing page. Vertical
writing, three or more columns, and desktop platforms retain the captured-page
fallback.

Fixed layouts name their pages with `getPageTurnKey()` but cannot preview them.
A turn there captures the current page, navigates under the native cover, then
captures the destination. Pages already resident, such as the one just left,
start without navigating first.

Android PixelCopy captures the current page and its neighbours, clipped to the
WebView (the CSS viewport can round a pixel or two past it), as full physical
resolution ARGB8888 bitmaps. The bitmaps upload directly to ES2 textures, with at
most three resident pages. Native animation commands carry page identities,
gesture data, and completion acknowledgements; they do not carry encoded images
or JavaScript image buffers.

The native view lives in a non-touchable PopupWindow. PixelCopy reads the
Activity window underneath it, so preparing a neighbour does not capture the
visible cover. JavaScript prepares adjacent paginator positions while idle,
using cancellable previews that restore the reading position without adding
history or relocation events. Theme changes, reflow, backgrounding, and owner
changes invalidate cached pixels; a reader-state write that changes no field
does not.

## iOS

iOS keeps the same commands and page identities. `WKWebView.takeSnapshot`
captures full-scale pages, waiting for WebKit's next presentation update; it
renders only the web view's own layers, so the Metal sheet, a sibling view
above the web view, is never captured. Regions snap to device pixels so one
texel maps to one pixel. Each snapshot is redrawn as 8-bit BGRA and copied
into a Metal texture, since `MTKTextureLoader` cannot decode WebKit's snapshot
images, and at most three pages stay resident. A WebContent crash or a new
main-frame document drops the scene, as the old page can no longer finish its
turn.

Everything runs on the main thread. A frame is encoded, scheduled and
presented with the Core Animation transaction that shows or hides the sheet
(`presentsWithTransaction`), so a scene is ready when its command returns and
no cancel can overtake it. A passive gesture recognizer follows the finger
without claiming the web view's touches. CADisplayLink settles a released
sheet, advancing at most 1/6 of the minimum duration per refresh. The
web-view barrier before `finish` and `idle` is a 1x1 snapshot, which completes
after WebKit's next presentation update, followed by one display refresh.

## Android

Android tracks MotionEvents and uses Choreographer to settle a released sheet.
EGL rendering runs on a dedicated thread. Settlement submits one pose at a time,
then waits for the hardware layer to acquire that image before advancing. An
EGL presentation timestamp is checked against the acquired SurfaceTexture
timestamp from a hardware frame-commit callback. Delayed frames advance the
animation clock by at most 1/6 of the minimum 100 ms duration, preserving
intermediate poses under GPU load. The next pose is submitted directly from the
acknowledgement. Finger-follow updates retain their coalesced draw path.

The final sheet stays visible until a WebView visual-state callback and committed
Activity frame confirm the destination. Idle preview restoration uses the same
barrier. Turn identities prevent stale completion callbacks from affecting a new
turn. Rapid taps and swipes queue complete begin/end pairs; queued requests
recheck book boundaries. A backward attempt at the cover that does not change
the page identity creates no fictitious returning sheet.

Cancellation of a resident sheet does not navigate. Cold navigation that
actually changes the page is rolled back once on cancellation. Native commits
skip the paginator's legacy unlock delay. Other reading modes retain their
normal navigation timing.

Only one reader owns the native scene at a time. A competing capture during an
active turn reports that it is not ready without disposing the owner's scene or
pending commands. Native rendering failures discard the scene and its cached
page identities so the next eligible gesture can retry. Captured-page failures
in unsupported modes instead disable capture for the session and use the
existing renderer fallback.

## Paper geometry and sampling

The TypeScript, Kotlin and Swift mesh implementations clip the paper at 64 parallel
hinges before applying successive rotations of pi / 65 over a bend band of
0.7 times the leaf width. Texture coordinates remain attached to the original
paper. Perspective projection and depth produce the fold, and the mesh carries
an explicit paper-side bit for face shading.

Backward navigation reverses the deformation of the previous sheet while
keeping the book's spine in place. Reading direction remains independent of
navigation direction. On a spread the bend tapers to zero as the sheet reaches
the spine. Progress starts with a flat page and finishes with the destination
fully visible.

Flat native sheets use nearest-pixel sampling; moving folds use linear
interpolation. High-precision shader coordinates are used where supported.
Captured pixels already contain the reader's theme colours, so the native view
disables a second system force-dark pass.

## Fallback and diagnostics

`CapturedPageTurn` coordinates native capture, overlay rendering, navigation,
and cancellation for the fallback path. `PageTurnBuffer` caches up to three
page images and invalidates them when layout or visible content changes.
Platforms with a native cover keep it over the outgoing page during capture.

Set `NEXT_PUBLIC_PAGE_CURL_DIAGNOSTICS=1` when building to enable page-turn timing
diagnostics. Normal builds leave diagnostics disabled.

## Verification

From `apps/readest-app`, run the targeted unit and Chromium suites:

```sh
pnpm test --run src/__tests__/utils/native-page-turn.test.ts src/__tests__/hooks/useCapturedTurn-scrollLock.test.ts src/__tests__/hooks/useCapturedTurn.test.ts src/__tests__/utils/page-curl-mesh.test.ts src/__tests__/utils/page-turn-diagnostics.test.ts
pnpm test:browser src/__tests__/document/fixed-layout-page-turn-key.browser.test.ts src/__tests__/utils/captured-turn.browser.test.ts src/__tests__/utils/page-curl.browser.test.ts src/__tests__/utils/page-turn-buffer.browser.test.ts src/__tests__/document/paginator-paginated.browser.test.ts src/__tests__/document/paginator-resize-anchor.browser.test.ts
pnpm lint
```

From `apps/readest-app/src-tauri/gen/android`, with the Android SDK and a running
emulator configured:

```sh
./gradlew :tauri-plugin-native-bridge:testFossGenericPenDebugUnitTest :tauri-plugin-native-bridge:connectedFossGenericPenDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=com.readest.native_bridge.NativePaperTurnTest
```

The Android tests cover frame presentation, full-resolution text detail,
cancellation, competing reader ownership, and repeated turns under delayed GL
work. Emulator checks establish functional behaviour; physical-device input
latency and frame pacing require measurements on the target hardware. Build
results and known full-suite failures belong in the pull request.
