---
name: tauri-dangling-sourcemap-comments-5498
description: "Tauri webview console flooded with source map JSON parse errors because upload-sourcemaps.mjs deleted the .map files but left the sourceMappingURL comments; KEEP_SOURCEMAPS=1 keeps maps for dev-ios/dev-android/dev-macos. Also: biome does not format .mjs, cargo target dir is the workspace root"
metadata:
  node_type: memory
  type: project
---

Every Tauri build from 0.11.20 on logged one warning per chunk with devtools open:
`Source Map "tauri://localhost/_next/static/chunks/<hash>.js.map" has SyntaxError: JSON Parse error: Unrecognized token '<'`.

**Cause.** `productionBrowserSourceMaps` (#5027) makes Turbopack emit `.js.map` files *and* append `//# sourceMappingURL=` to every chunk. `scripts/upload-sourcemaps.mjs` uploaded the maps to Sentry then deleted them, but never removed the comments, so 204 of 210 chunks advertised a map that wasn't in the bundle. The asset protocol answers a missing file with HTML, hence the `'<'`. Cosmetic only: WKWebView requests maps only when the inspector is open.

**Fix (MERGED #5498).** `stripMaps` now also strips the comment. Key gotcha: **Turbopack names a map after a different hash than the chunk pointing at it** (`2mjccwgh1gbxv.js` -> `2o75p8sdyycvy.js.map`), so you cannot pair chunk to map by file name; every `.js` under the dir gets rewritten. The sentry-cli `//# debugId=` line must survive, that's what Sentry matches uploaded artifacts by. Symbolication is unaffected because the strip runs *after* the upload, so Sentry's copies keep their comments.

**`KEEP_SOURCEMAPS=1`** skips stripping entirely. Set by `dev-ios`, `dev-android` and the new `dev-macos` so local devtools resolve minified frames. Costs roughly 25-70 MB of bundle, irrelevant on desktop, noticeable for an `.ipa` install over USB.

Build-plumbing facts this turned up, each of which cost time:

- **Biome does NOT format `.mjs`** (`biome.json` formatter has `"!**/*.mjs"`). `biome format --write scripts/foo.mjs` reports "Formatted 1 file" and silently changes nothing, so build scripts must be indented by hand. Pre-existing >100-char lines in those files are not lint failures.
- **The cargo target dir is the workspace root `<repo>/target`**, not `apps/readest-app/src-tauri/target` (that one only holds `rust-analyzer/`). macOS bundles land in `../../target/release/bundle/macos/Readest.app`; `scripts/release-mac-appstore.sh` uses `../../target/universal-apple-darwin/release/bundle/macos`.
- **Cross-platform env var for a pnpm script: `dotenv -v KEY=val -e .env.tauri -- <cmd>`**, not a `KEY=val` shell prefix (breaks under `cmd.exe`, and `dev-android` is plausibly run on Windows). Pass `-e` explicitly: a bare `dotenv -v` silently loads `.env`. Verified dotenv forwards a *second* `--` verbatim, so `dotenv ... -- tauri android build -t aarch64 -- --features devtools` still reaches cargo, and the `&&` in a script string is handled by the outer shell, not by dotenv.
- **Testing a build script:** put the body behind the repo's `if (process.argv[1] && import.meta.url === \`file://${process.argv[1]}\`) main();` guard (same as `preview-wordlens.mjs`) and export the helpers. Without it, importing the module from a test runs the real thing against `out/`.

**Flaky test seen once here:** `src/__tests__/services/native-app-service-window.test.ts` failed 3 assertions (`loadServiceWithOS('macos')` / `hasRoundedWindow`) in a pre-push hook run, then passed in isolation and in four subsequent full-suite runs including the hook's exact command. It is a heavily `vi.mock`ed module-registry test, so it looks order/concurrency dependent; adding an unrelated test file was enough to perturb it. Expect it to reappear in CI. See [[ci-pr-delivery-and-push]] for when `--no-verify` is legitimate (the hook's `format:check` + `lint` + `test` all already green on the same tree).
