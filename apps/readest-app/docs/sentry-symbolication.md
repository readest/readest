# Sentry symbolication (source maps + debug files)

Crash reports from production carry minified JS chunk names (`w`, `#b`,
`chunks/05.7xrfq2vajv.js`) and unsymbolicated native frames. To turn those into
real file:line stacks, Sentry needs the browser **source maps** and the native
**debug files** for each release.

## Prerequisite: `SENTRY_AUTH_TOKEN`

Create an **org auth token** in Sentry (Settings -> Auth Tokens, scope
`project:releases` + `org:read`) for org `readest`, then add it as the GitHub
Actions secret **`SENTRY_AUTH_TOKEN`** (used by `release.yml` and `nightly.yml`).
`SENTRY_ORG` (`readest`) and `SENTRY_PROJECT` (`readest`) are written alongside
`SENTRY_DSN` into the build's `.env.local`.

Nothing below runs without this token: local and fork builds are unaffected.

## Browser JS source maps (implemented)

Covers every `platform: javascript` issue (the reader/TTS crashes on
`tauri.localhost`).

- `next.config.mjs` sets `productionBrowserSourceMaps` for the Tauri **export**
  build, so `next build` emits `.js.map` files next to the chunks in
  `out/_next/static`.
- `scripts/upload-sourcemaps.mjs` runs right after `next build` (it is chained
  into the `build` script). It:
  1. `sentry-cli sourcemaps inject` — writes a Sentry debug ID into each chunk
     and its map (host-agnostic matching; chunks are served from
     `tauri.localhost`, which has no stable URL).
  2. `sentry-cli sourcemaps upload` — uploads the maps, associated with release
     `Readest@<package.json version>` (matches `sentry_config.rs::sentry_release`)
     and a `~/_next/static` URL prefix as a fallback matcher.
  3. Deletes every `.js.map` so maps never ship inside the app bundle.
- Any Sentry failure is logged but never fails the build.

Validate on the next nightly: open a symbolicated JS issue and confirm real
file:line frames appear.

## Native debug files (not yet enabled — follow-up)

The credentials + env are already wired for these jobs; each still needs a small,
build-touching change that must be validated on a real native build (the Android
and iOS builds are fragile — see the build gotchas in project memory), so they
are intentionally left as a focused follow-up rather than shipped unverified.

### Android
- **Kotlin/Java stacks + ANRs** (e.g. `RustWebViewClient in shouldOverride`)
  need the **Sentry Android Gradle plugin** (`io.sentry.android.gradle`) in
  `gen/android/app/build.gradle.kts`: it embeds the ProGuard mapping UUID into
  the app and auto-uploads `mapping.txt` on release builds. A bare
  `sentry-cli upload-proguard` cannot work without the embedded UUID.
- **Native (`.so`) crashes** (`android::Looper::pollInner`,
  `Java_..._WryActivity_create`) need the release build to keep unstripped debug
  info (`ndk.debugSymbolLevel = "full"` or an unstripped variant), then
  `sentry-cli debug-files upload` the `.so` files.

### iOS
- Upload dSYMs after the Xcode archive with
  `sentry-cli debug-files upload --include-sources <archive>/dSYMs`. The App
  Store release runs from a local script, so add it there (or to the CI archive
  step if one is added).

## Local release builds

The maintainer's local `.env.local` already carries `SENTRY_DSN`; add
`SENTRY_AUTH_TOKEN` (+ optionally `SENTRY_ORG`/`SENTRY_PROJECT`, which default to
`readest`) there and `pnpm build` uploads JS source maps automatically.
