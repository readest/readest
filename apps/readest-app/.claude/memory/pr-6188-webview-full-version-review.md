---
name: pr-6188-webview-full-version-review
description: "PR #6188 (WebView build via UA Client Hints) review — 2 real defects, telemetry schema break, unrequested de-localization; NOT merged"
metadata: 
  node_type: memory
  type: project
  originSessionId: 2d78dddf-0f1d-4485-8888-c426c9ca8e63
  modified: 2026-09-16T15:08:37.494Z
---

PR #6188 `feat(about): show the real WebView build number instead of the UA-reduced stub`
by k6G52m4Dz75W (same contributor as merged #6047). Reviewed 2026-09-16 at head
`492da91b7`. **CLOSED 2026-09-16** (comment 5699962427), worktree removed.

**Why closed, the load-bearing fact:** `tauri::webview_version()` already returns the
REAL full build on every platform and readest had never called it. Re-exported at
`packages/tauri/crates/tauri/src/lib.rs:200`, backed by wry 0.56.1: Windows =
`GetAvailableCoreWebView2BrowserVersionString`, macOS/iOS = `com.apple.WebKit` bundle
`CFBundleVersion`, Linux GTK = `webkit_get_major/minor/micro_version()`, Android =
queries the WebView package. One call inside `sentry_config.rs` (the file that already
sets the tag), ZERO frontend surface, and it works on WebKit where Client Hints
structurally cannot. Caveats: Windows appends a channel suffix on non-stable runtimes
(`"138.0.3351.62 beta"`); Linux CEF still needs the UA path (it reports WebKitGTK).
Also: no readest issue has ever turned on a WebView PATCH build — #358/#683 (runtime
missing), #4398 (corrupt window-state), #4727, #4866, #1453 are all major-or-coarser,
as are tap-death (WebView 148), iOS<=16 fonts.ready, and the Arch CEF SIGSEGV. The
major is the actionable unit, and making `webview.version` the full build would LOSE
that aggregation.

Green: 11093 vitest pass, `pnpm lint` clean, `cargo fmt --check` clean, clippy clean,
151 Rust tests pass. CodeRabbit's one comment was already fixed in `d2f1485c1`.

Defects found (all reproduced by running code, not by reading):

1. **Chrome label + Edge build.** `parseWebViewInfo` picks the engine NAME by UA branch
   order — the `Macintosh && Chrome && AppleWebKit` branch (`ua.ts:62`) fires before the
   `Edg/` branch (`:70`) — while `clientHintsBrandFor` (`:105`) picks the VERSION by `Edg/`
   presence. macOS Edge therefore renders `Chrome 138.0.3351.62`: an Edge build attributed
   to Chrome, a string that never shipped. Worse than the reduced stub it replaces, and it
   is the About dialog's copy-to-clipboard bug-report text. RULE: never pair a UA-derived
   engine label with a Client-Hints-derived version — derive both from the same source.
   See [[bug-patterns]].
2. **`await getWebViewFullVersion()` on the cold-start path** (`nativeAppService.ts:643`),
   before `loadSettings()`. `try/catch` cannot rescue a promise that never settles, and
   `EnvContext.tsx:44` documents that exact failure as "a blank window for the rest of the
   session". No consumer in `init()` needs the value — fire-and-forget the whole block.
3. **`typeof navigator === 'undefined'` is dead code.** Node >= 21 defines a global
   `navigator`; Node 24 here reports `navigator.userAgent === 'Node.js/24'`. Verified with
   `node -e`. Prerender guards must use `typeof window`/`typeof document`.
4. **Sentry tag schema break, needs an explicit call.** `webview.version` goes from the
   major (`"140"`, ~10 values) to the full build (`"140.0.6099.230"`, thousands across the
   Android fleet) — high-cardinality indexed tag, and every saved `webview.version:140`
   search returns zero. Separately Windows flips `webview.engine` `Chromium` -> `WebView2`.
   Fix shape: keep the major as the tag, put the build in a context or a `webview.build` key.
5. **De-localization was never asked for.** `_('Version {{version}}')` -> `Readest ${v}`
   in `AboutWindow.tsx:86` drops the translated word for every non-English user, and the
   justifying comment ("would hide the app name") is false — `<h2>Readest</h2>` sits two
   lines above at `:116`, so the dialog now prints "Readest" twice. Right shape: keep the
   DISPLAY localized, build a separate locale-neutral string for `handleCopyVersion` only.
   The i18n key is not orphaned (`UpdaterWindow.tsx:601` still uses it).

Nits: `upgradeLabelVersion` (`ua.ts:171`) no-ops on versionless labels (`'WebView2'`,
`'Chromium'`) so the Client-Hints fallback silently does nothing there — narrow reach,
since a versionless label usually also means `clientHintsBrandFor` returned null;
`fullVersion` is interpolated into a `String.replace` replacement unvalidated, so a
`$&` from a UA-spoofer shim duplicates the UA (use a replacer fn); Rust
`ua_token_version` has no length bound on the digit/dot run; the two
`withWebViewFullVersion` tests are nested inside `describe('parseWebViewVersion')`.

Also noted: `parseWebViewVersion` in `ua.ts:184` has zero consumers — pre-existing dead code.
