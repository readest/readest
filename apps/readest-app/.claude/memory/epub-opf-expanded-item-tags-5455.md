---
name: epub-opf-expanded-item-tags-5455
description: "#5455 native Rust OPF parser skipped `<item></item>` / `<meta></meta>` (Event::Empty only) - fix + why the bug is invisible on Android and masked by the undeclared-cover fallback"
metadata:
  node_type: memory
  type: project
---

Issue #5455 (reported on iOS, OPDS-downloaded book has no library cover). **MERGED as PR #5463** (2026-08-03, merge commit `8ad906bc4`); issue closed. Ships in the release after 0.11.20.

**Root cause.** `epub_parser.rs` matched manifest `<item>` and metadata `<meta>` only under `Ok(Event::Empty(e))`. quick-xml emits `Empty` **only** for self-closing tags; the equivalent `<item ...></item>` is `Start` + `End`, so an OPF serialised that way (BookOrbit and other OPDS servers do it) yielded an **empty manifest** in BOTH `parse_opf_cover_inputs` (no cover) and `locate_toc_sources` (no nav, no NCX on the open hot path). Fix = `reader.config_mut().expand_empty_elements = true` on both readers + move item/meta handling into the `Start` arm. Empty→Start+End also keeps `in_manifest`/`in_metadata` balanced for a degenerate `<manifest/>`.

**Two things that hide this bug — budget for them before reproducing:**
1. `resolve_cover_path` falls back to `find_undeclared_cover_entry` (zip entry named `*cover.{jpg,png,…}` / `*couv.*`). **That fallback is #5339, merged 2026-07-26 — AFTER the 0.11.20 release (2026-07-20).** So on any `dev` build (and on any local build whose versionName still says 0.11.20) a book whose cover entry is named `cover.jpg` shows a cover even with the manifest defect present, while released 0.11.20 (what the OP runs) shows none. Reproducing on a dev build needs the cover image named something else (used `images/front.jpg`). Always check ancestry against the user's released version before concluding "can't reproduce".
2. The native fast path is only attempted for a **string path matching `/\.epub$/i`** (`bookService.ts` → `tryNativeParseEpub`). See [[android-nativefile-remotefile-io]] for the platform I/O split.

**Which flows actually reach the Rust parser** (this explains the reporter's iOS asymmetry):
- OPDS auto-download → `services/opds/autoDownload.ts` calls `appService.importBook(dstFilePath, books)` with a **real path** → native parser → bug visible.
- Android file picker → tauri dialog returns `content://com.android.fileexplorer.myprovider/...../x.epub`. It passes the `.epub` regex but `Path::exists()` is false in Rust → bridge catches, warns, returns null → **foliate-js fallback**, cover fine. So the bug is effectively invisible for Android picker imports; don't try to reproduce it that way.
- Presumably the same on iOS for a Files/iCloud pick (security-scoped URL → raw `File::open` fails → JS fallback), which is why the reporter's manual import kept the cover.

**Device-probe recipe (Xiaomi 13, no library pollution)** — see [[cdp-android-webview-profiling]] for the CDP setup:
- `adb shell appops set com.bilingify.readest MANAGE_EXTERNAL_STORAGE allow` + restart the app, then CDP-`invoke('parse_epub_metadata', {filePath:'/storage/emulated/0/Download/x.epub'})`. Without the appop it's `partial_md5 failed: Permission denied`. Reset to `default` when done.
- The Tauri **fs plugin scope is separate**: importing that same `/sdcard` path through the app fails with `forbidden path`, and `invoke('allow_paths_in_scopes', …)` did **not** lift it. So `location.href = '/library?file=<sdcard path>'` (a real ingress route, `helpers/openWith.ts` reads `?file=`) can't be used to drive an end-to-end import from `/sdcard`.
- Hooking `window.__TAURI_INTERNALS__.invoke` (even via `Page.addScriptToEvaluateOnNewDocument`) records **zero** of the app's invokes — the bundled `@tauri-apps/api` doesn't route through that property at call time. Don't waste time on it; probe the command directly instead.

**Verified on Xiaomi 13** (fixture pair: identical EPUBs differing only in OPF serialisation): pre-fix build → expanded `coverBytes: 0`, `navPath: null` vs self-closing `86726` / `OEBPS/nav.xhtml`; rebuilt with the fix → both identical. `pnpm dev-android` reinstalls over the sideloaded release build with `-r`, data preserved (see [[android-sideload-same-versioncode]]).

**OP's real file** (`readest_test.epub`, Neuromancer via BookOrbit/calibre 9.1.0, attached to the issue 2026-08-03): every `<item>`/`<meta>` expanded; cover declared as `<item id="cover" href="cover.jpg" properties="cover-image">` with `OEBPS/cover.jpg` (1649x2475, 702 KB) present, plus a decoy `OEBPS/inserted_file_001_.jpeg`, and `<item id="nav" href="../nav.xhtml">` pointing OUTSIDE the OPF dir. Pre-fix: `manifest_len 0`, `cover_id None`, `resolve_cover None`, `nav_href None` → on released 0.11.20 that means **no cover at all**. Post-fix: `manifest_len 41`, `cover_id Some("cover")`, `resolve_cover Some("OEBPS/cover.jpg")`, `nav_href Some("../nav.xhtml")`, cover 74230 B; same numbers on-device. foliate-js parses the file fine either way (cover 702274 B, 35 sections, 9 TOC items), which is why their manual iCloud import kept the cover.

**Still open in the same function:** when `resolve_cover_path` returns a path that is NOT in the zip, `parse_epub_metadata_sync`'s `Err(_) => (None, None)` arm gives up instead of falling through to `find_undeclared_cover_entry`. Didn't bite this book (`OEBPS/cover.jpg` exists), no issue filed.

Related: [[epub-undeclared-cover-entry-5273]] (the fallback that masks this), [[tauri-parser-parity-tests]] (`test:tauri` parity suite would catch this class, but it is **not** wired into CI — chrox declined adding the 993 KB OP file as a fixture).
