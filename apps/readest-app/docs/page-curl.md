# Paper page turn

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
| Hinges / total rotation | 64 / π radians |
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
cleared single page. The fold is offset to avoid a jump on the first drag
sample. On a two-column spread the bend tapers to zero so the incoming page
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

An ARM64 debug APK was built with the production frontend export. APK signature
verification passed. No physical Android device was available for playback tests.
The debug APK contains native debug symbols and is approximately 718 MiB.

This Windows environment required isolated temporary Rust and Windows SDK tools.
The cached turso_ext 0.6.1 build script was patched locally to check
`CARGO_CFG_TARGET_OS` instead of the build host's `cfg!(target_os)` before linking
advapi32; otherwise it incorrectly links a Windows library into Android. The
dependency version and lockfile remain unchanged. Generated Android build files
use Kotlin 2.2.10 with incremental compilation disabled to avoid cross-drive
cache failures. A nonexistent `jdk.net.unixdomain.tmpdir` forces the installed
JDK's broken Unix-domain socket path to fall back to TCP for Gradle.
