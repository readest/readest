---
name: android-themed-icon-4733
description: "Android Material-You themed (monochrome) launcher icon — restoring it (#4733), the gen/android force-commit pipeline, and emulator verification"
metadata: 
  node_type: memory
  type: project
  originSessionId: 6bc82dac-a705-4ef2-ab28-c13b43f48a46
---

Issue #4733 = add Android themed (Material You / monochrome) launcher icon. It had
existed (#2122/#2153 added `ic_launcher_monochrome.png`) but PR #2353 ("fixed
launcher icon size") rewrote the committed adaptive icon to inset the foreground
22% and **silently dropped the `<monochrome>` layer**, so themed icons stopped
working. Fix = re-add `<monochrome><inset android:drawable="@mipmap/ic_launcher_monochrome" android:inset="22%"/></monochrome>`
to `ic_launcher.xml` + ship the monochrome mipmaps.

**Android icon pipeline (non-obvious).** `src-tauri/gen` is gitignored, BUT specific
customized res files are **force-added** (tracked): `mipmap-anydpi-v26/ic_launcher.xml`,
`drawable/ic_launcher_background.xml`, `values/themes.xml`, `splash_icon.png`. CI
(release/nightly/android-e2e) does `rm -rf gen/android` → `tauri android init` →
`tauri icon ../../data/icons/readest-book.png` → **`git checkout .`** (restores the
tracked customizations) → build. So **the committed gen files are the build's source
of truth.** `tauri icon` (CLI 2.10.1) writes gen mipmaps + a DEFAULT `ic_launcher.xml`
(foreground+background only) and does NOT emit a monochrome layer — so the monochrome
PNGs (or a vector drawable) MUST be force-committed into `gen/.../res/` to survive
`git checkout .`. `git add -f apps/.../gen/.../mipmap-*/ic_launcher_monochrome.png`.
`src-tauri/icons/android/*` is the historical master but is NOT what the build reads.

**Themed tint = SRC_IN (alpha only).** The launcher replaces the monochrome layer's
RGB with the wallpaper tint, keeping only alpha → any fully-opaque artwork flattens
to a solid blob (the original desaturated-logo monochrome lost all detail). Convey
character via negative space. For Readest we kept the existing artwork and carved a
**narrow vertical center-gap (spine)** via an alpha-multiply mask (ImageMagick:
`magick src -alpha extract a.png; magick -size WxH xc:white -fill black -draw "roundrectangle ..." g.png; magick a.png g.png -compose multiply -composite na.png; magick src na.png -alpha off -compose CopyOpacity -composite out.png`),
gap ≈ centered, width ~4% of content, from ~3%→84% of content height (pages stay
joined at the binding). Preview-as-themed = tint `-colorize`, inset to central 56%
(=22% inset), composite over dark bg, circular mask.

**Emulator verify (Pixel_9_Pro AVD, Google Play image, NexusLauncher).** Themed icons
toggle: Wallpaper & style (`am start -n com.google.android.apps.wallpaper/com.android.customization.picker.CustomizationPickerActivity`)
→ "Home screen" tab → "Themed icons" switch. Only the **home screen/dock** is themed;
the **app drawer keeps full color** (expected, not a bug). `uiautomator dump` returns
"null root node" on the wallpaper picker (SurfaceView) → navigate by screenshot
coords. Build for emulator = `pnpm tauri android build --debug --target aarch64 --apk`
(NDK_HOME must be set). Gradle-standalone (`./gradlew :app:assembleUniversalDebug`)
fails: the `rustBuild*` task shells `pnpm tauri ...` which panics at
`tauri-cli/src/mobile/mod.rs:403` unless driven by `tauri android build`. Confirm the
APK packaged it: `aapt2 dump xmltree --file res/mipmap-anydpi-v26/ic_launcher.xml app.apk`
should show an `E: monochrome` node. Regression guard:
`src/__tests__/android/themed-icon.test.ts` (asserts `<monochrome>` in the XML + a
tracked monochrome mipmap per density). Related: [[dict-lookup-browser-hijack-4559]]
(Android resource/manifest gotchas), [[android-cdp-e2e-lane]].
