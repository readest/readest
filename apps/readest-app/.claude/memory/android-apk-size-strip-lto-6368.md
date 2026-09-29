---
name: android-apk-size-strip-lto-6368
description: "Why the arm64 APK was 90MB and the four things that cut it to 57MB; AGP's strip leaves .symtab, and android.ndkDirectory throws in this module."
metadata: 
  node_type: memory
  type: project
  originSessionId: 2a57df55-e0fc-4741-bb9a-07aa2af236df
  modified: 2026-09-22T18:08:31.561Z
---

**MERGED #6368 as 8750c3104 (2026-09-23), squashed, UNRELEASED.** arm64 APK
89.7MB -> **57.5MB measured** on an aarch64 release build. 95% of the APK is
`libreadestlib.so`, stored uncompressed, and most of it was not code.

**The traps, in order of how much they cost:**

- **AGP's `strip*DebugSymbols` only drops `.debug_*`.** `.symtab` + `.strtab`
  (22.3MB; 10MB once LTO runs) shipped in every download. `jniLibs.keepDebugSymbols`
  is debug-only and was never the cause. Fix = an extra `llvm-strip --strip-all`
  in `gen/android/app/build.gradle.kts`, hooked on `doLast` of every
  `strip*ReleaseDebugSymbols` task, over `outputs.files`. It runs on AGP's
  output copy, so `target/` keeps the unstripped library for Sentry.
- **`android.ndkDirectory` THROWS "NDK is not installed"** in this module — it
  declares no `ndkVersion`, and the Rust side gets its NDK from `NDK_HOME`
  instead. Find `llvm-strip` by hand: env (`NDK_HOME`/`ANDROID_NDK_HOME`/
  `ANDROID_NDK_ROOT`) then a scan of `android.sdkDirectory/ndk/*` (a reused
  Gradle daemon may not have the env var).
- **The workspace had NO `[profile.release]` at all**, and **`codegen-units = 1`
  is the ENTIRE code-size win — LTO buys nothing.** Flag-verified via
  `cargo build -v`: cgu=16/lto=false gives `.text` 29.66MB, `.eh_frame` 3.69,
  `.gcc_except_table` 2.51; cgu=1 with lto off/thin/fat ALL give 24.43/2.28/1.84.
  Whole-APK check: 57.49MB without LTO vs 57.50MB with fat. Cost of cgu=1 alone:
  clean aarch64 build 5m54s vs 4m15s, peak RSS 3.3GB vs 2.9GB. I first credited
  the win to fat LTO and had to correct it (commit 31bdb90).
- **Stripping only pays on Android, because the APK stores the `.so` `Stored`
  (0% compressed)** — every stripped byte leaves the download. Everything else
  compresses symbol strings: macOS measured 4.76MB off the binary but only
  **1.44MB off the DMG** (36.59 -> 35.15MB; `.app` 57.91 -> 53.25MB, updater
  tar.gz 35.78 -> 34.35MB). deb/rpm/AppImage are compressed too; MSVC keeps
  symbols in the PDB. DECIDED NOT to strip desktop: the only hooks are a
  profile-level `strip` (which destroys the unstripped artifact Sentry needs)
  or pulling the release job apart from `tauri-action` (build+bundle+sign+
  notarize in one step; on macOS strip must precede signing). `tauri bundle`
  DOES exist as a separate CLI command if that is ever revisited.
  TWO measurement traps: (1) a custom profile with `inherits = "release"`
  INHERITS the workspace release keys you are trying to compare against — set
  every key explicitly or the "baseline" silently carries your change;
  (2) a custom profile makes tauri's codegen skip embedding `out/`, so `.rodata`
  collapses to ~2.8MB and only the code sections are comparable. Confirm what
  rustc really got: `cargo build -v | grep -oE '\-C (lto|codegen-units)=[a-z0-9]+'`.
- **Stripping costs Rust panic symbolication** unless CI uploads debug files.
  The `.so` had NO `.note.gnu.build-id` (NDK linker emits none) — added via
  `build.rs` `cargo:rustc-link-arg=-Wl,--build-id=sha1` for `target_os = android`
  (survives a `RUSTFLAGS` env that would override `.cargo/config` rustflags).
  Also needed the `debug-images` sentry feature. Release + nightly now run
  `sentry-cli debug-files upload ../../target/*/release/libreadestlib.so`.
- **Tauri embeds EVERY file in `out/`** (and `public/` is copied there whole),
  so **any path alias resolving into `public/` double-ships**: once bundled into
  a chunk, once published and never fetched. THREE cases: jieba (2.7MB),
  simplecc (0.4MB, byte-identical) and pdfjs's `pdf.min.mjs` (transformed, so a
  content-hash scan misses it — only the worker is fetched by URL). Fix = split
  by HOW a file loads: runtime-URL files stay in `public/vendor/pdfjs` (worker,
  wasm decoders, cmaps, standard_fonts, layer CSS — foliate-js/pdf.js builds
  those URLs at runtime, which is why the bundler never copied them), and
  bundler-imported files move to `vendor/` outside `public/`. Guard test:
  `vendor-aliases-outside-public.test.ts` (no tsconfig alias may point into
  `public/`). Embedded frontend 23.7MB -> 16.96MB brotli, on EVERY tauri target.
  jieba's WASM was there twice (2.7MB): the wasm-bindgen glue
  defaults to `new URL('<name>_bg.wasm', import.meta.url)` which the bundler
  always emits, and `init('/vendor/jieba/...')` embedded a second copy. The
  turso WASM (3.3MB) shipped in native builds because the exclusion alias still
  named `@tursodatabase/database-wasm` while `webDatabaseService` imports
  `@readest/turso-database-wasm/webpack` since #4086 — a stale alias fails silently.
  simplecc is STILL duplicated (0.4MB): its glue is imported through the
  `@simplecc/*` tsconfig/vite alias out of `public/vendor`, so deduping means
  moving that directory.

**Source maps are NOT the problem** — `scripts/upload-sourcemaps.mjs` strips all
250 `.js.map` before Tauri embeds `out/` (only two small `.css.map` slip through).
A local `out/` with `KEEP_SOURCEMAPS=1` is 205MB and misleads any size analysis.

**Unverified:** whether jieba's WASM is fetched at runtime — release webviews
expose no `webview_devtools` socket, and the `Intl.Segmenter` fallback is silent.
Static evidence only: the embedded asset key matches the requested URL exactly.
Device run on Xiaomi 2211133C: installs, library + Chinese book render, RSVP runs.
NO PR check builds Rust in release mode (`test:pr:tauri` runs `tauri dev`), so
release-profile cost first appears in nightly (75min android step, 45min desktop,
90min job backstop). CodeRabbit's only finding on #6368 was exactly this.

**#6368 broke TWO push-only workflows on main** (neither runs on PRs, so the
PR was green): `docker-image.yml` (`build-web`: "Can't resolve
'@pdfjs/pdf.min.mjs'" — a generated dir needs its own
`COPY --from=dependencies`; `.gitignore`/`.dockerignore` do NOT apply to
stage-to-stage copies) and `nix-build.yml` ("no matching package named
`sentry-debug-images`" — the Linux CEF build vendors from **`Cargo.cef.lock`**,
which `nix/package.nix:83` copies over `Cargo.lock`; `nix-deps-check` hashes
only that file, so it stays green when `Cargo.lock` alone changes). Fixed in
#6379: hand-added the two crates to `Cargo.cef.lock` + new `cargoHash` from the
deps-check `got:` line. ALWAYS check push-only workflows after touching build
inputs.

Analysis recipe: `unzip -lv` the APK, then `llvm-readelf -S -W` the `.so`;
attribute `.text` by crate with `llvm-nm -S --size-sort -C` aggregated on the
first `::` segment. See [[build-ci-recipes]].
