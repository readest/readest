---
name: epub-embedded-video-kotobee-1812
description: "#1812 Kotobee fixed-layout EPUB embedded videos don't play: <video> is created at runtime by kotobeeInteractive.js with a relative src that can't resolve inside foliate-js blob documents; repro recipe + investigation state"
metadata: 
  node_type: memory
  type: project
  originSessionId: 0d736bfa-ee30-4fe6-a118-40ecc8948b0e
  modified: 2026-08-25T07:55:00.564Z
---

Issue https://github.com/readest/readest/issues/1812 (OPEN, filed 2025-08-14, v0.9.71 Linux): "Embedded video is not playable" in a Kotobee-exported EPUB. Reporter expects Kotobee Reader behaviour.

**Repro file:** `/Users/chrox/Documents/books/issues/1812/Bk1-Pt1.epub` (315 MB, mostly mp4s). Fixed-layout (`rendition:layout pre-paginated`, `ibooks:interactive true`, `kotobee:version 1.8.3`). Video pages: `EPUB/xhtml/pdfnvzq0/page{16,20,24,28,30,35,46,49,54,60,65,73}/pageN.xhtml`.

**Mechanism (verified from the EPUB's own JS, session 2026-08-25):**
- Page XHTML has NO `<video>`; it has `<div class="kInteractive video" data-kotobee="<XORCipher+base64 payload>">` plus external `<script src="../../../js/kotobeeInteractive.js">` and `global.js`.
- Decoded page16 payload: `{"type":"file","video":"../../../video/1_1-lets-get-started.mp4","splash":"../../../imgs/aasplash.png",...}`.
- On play-button click `kotobeeInteractive.js` does `document.createElement("video")` and sets `src = kInteractive.cleanURL("../../../video/x.mp4")` (relative!) when `typeof isKotobee === 'undefined'`; only inside Kotobee Reader does it use `ph.join(kInteractive.absoluteURL, ...)`.
- Two gates in Readest: (1) scripts run only when `viewSettings.allowScript` is on (`FoliateViewer.tsx` `book.transformTarget` 'load' handler sets `detail.allow`; inline scripts on Tauri go through `evalInlineScripts`); (2) even with scripts on, a *dynamically created* `<video>` with a relative path resolves against the section's `blob:` document URL, so foliate-js's load-time href rewriting (Loader `createURL`/replace) never sees it -> 404/empty src. Hypothesis (2) NOT yet confirmed in a browser.

**Trimmed test EPUB recipe** (browser upload tool caps at 10 MB; the copy from the old session's scratchpad is GONE): unzip `mimetype META-INF/* EPUB/package.opf EPUB/css/* EPUB/js/* EPUB/imgs/aasplash.png EPUB/imgs/usersrobinhalldropbo.jpg EPUB/xhtml/raw/* EPUB/toc.ncx EPUB/xhtml/pdfygcoz/page1/* EPUB/xhtml/pdfnvzq0/page{15,16,20}/*`, ffmpeg-trim `video/1_1-lets-get-started.mp4` + `1_2-chords_w.mp4` to a few seconds, prune the OPF manifest/spine to ids `html0,html15,html16,html20,contents,ncx,img0,img1,img11,img12,img17,img84,vid0,vid4,css0,css1,css2,js0,js1`, zip with `mimetype` stored first -> ~5 MB. Import into web via synthetic drop on the library page (`useDragDropImport.ts` handleDrop) from a local CORS server.

**Root cause (CONFIRMED in Chromium via Playwright, 2026-08-25):** right after `kInteractive.video.action` the `<video src="../../../video/1_1-lets-get-started.mp4">` sits at `networkState 3` (NO_SOURCE) because a relative path cannot resolve against the section's `blob:` base; ~12 ms later the media `error` fires and Kotobee's listener calls `stopCurrentMedia()`, which removes the container and resets the play button. Same for the widget's splash: `style="background-image: url(../../../imgs/aasplash.png)"` set at DOMContentLoaded.

**MERGED 2026-08-25:** PR #5868 -> `5aae8d6c5` on main (squash); worktree removed, local + remote branches gone. Reporter verification still pending, and the issue is still open. foliate PR https://github.com/readest/foliate-js/pull/83 MERGED 2026-08-25 as a SQUASH -> `c09f06d` on main; the branch commit `060158f` is NOT an ancestor of main, so the submodule had to be re-pinned (`ea4e7c058`) or CI would chase an unreachable commit. Always check `git merge-base --is-ancestor <pin> github/main` after a foliate PR merges.

**Adversarial probes found a REAL race before the PR opened:** when a book script swaps one relative `src` for another while the first is still loading, both are parked (removed), so "is the attribute back?" cannot distinguish them and the STALE resolution won. Fix = a per-element `loading` map recording which reference each attribute is resolving; the write is dropped unless it is still current. Same pass memoized resolutions per document (`resolved: Map<string, Promise<string>>`), which cut a script-fights-back ping-pong from 42 loader calls to 1 and dedupes multiple elements sharing an href. Both encoded as tests.

**Fix (worktree `fix/epub-dynamic-media-src-1812`, branch of the same name):** `src/utils/dynamicResources.ts` `observeDynamicResources(doc, loadHref)`: MutationObserver + initial sweep over `img/video/audio/source/track[src]`, `video[poster]`, inline `style` `url()`; parks `src` synchronously (removeAttribute re-runs the media load algorithm, cancelling the pending `error`) then writes the blob URL from `section.loadHref`; loops guarded by a written-values map + an unresolvable set; `<source>` triggers `parent.load()`. Wired in `FoliateViewer.tsx` `docLoadHandler` when `allowScript` is on, BEFORE `evalInlineScripts`. foliate-js fork adds `loadHref: href => this.#loader.loadHref(href, item.href)` on the section object (child of the section, released with it). 10 unit tests; full vitest + lint + format green.

**Gotchas that cost time:** (1) EPUB sections are `application/xhtml+xml`, so `el.tagName` is lowercase (`video`, not `VIDEO`); compare `localName`. (2) jsdom's selector engine drops `[style*="url("]`; use `[style]` and filter by regex. (3) foliate FXL keeps hidden preload iframes of adjacent pages: pick the frame whose `frameElement` parent has `visibility: visible`, else clicks hit a detached copy. (4) tsx keep-names injects `__name` into Playwright `evaluate` callbacks with inner functions; pass the in-page code as a string IIFE. (5) The Claude-in-Chrome extension was disconnected; Playwright (`playwright` 1.60 in node_modules) + the e2e page objects (`e2e/pages/LibraryPage.ts` filechooser import, `ReaderPage.openSettings`, `[data-tab="Control"]`, `[data-setting-id="settings.control.allowJavascript"]`) drive the web app fine; scripts live in the session scratchpad with `node_modules` symlinked in.

**Verification record:** Chromium VERIFIED both ways with a trimmed repro (before: `networkState 3`, video torn down; after: blob src+poster, `readyState 4`, `paused false`, `currentTime` advancing). Full vitest 10087 passed / 16 skipped, lint + format green. Committed locally, NOT pushed: `0ca0f75fa` on `fix/epub-dynamic-media-src-1812` (worktree /Users/chrox/dev/readest-fix-epub-dynamic-media-src-1812) + foliate-js `060158f` on `fix/section-load-href`. No PR yet.

**Xiaomi VERIFIED 2026-08-25** (device 368b0948, APK md5 `3cf9d1b9e6c5a1c33cb3000ba7df0469`): both video pages play. `<video>` carries a `blob:http://tauri.localhost/...` src AND poster, `readyState 4`, `err null`; page16 ran to `t 4 / dur 4`, page20 caught mid-play at `t 2.26`; the widget's `background-image` is a blob URL too. Screenshot shows the native player with its timeline at 0:04 / 0:04.

**Device-driving recipe that worked (the file-import part is the fiddly bit):**
- A `file://` VIEW intent does NOT import on Android (delivered, silently ignored) — neither cold-start nor into a running instance. Import via the app's own picker: CDP-tap "Import Books" (`aria-label`), then the menu button whose text is `From Local File`, then `adb shell input tap` in the Mi file explorer (radio at the row's right edge, then OK bottom-right). "From Web URL" is an ARTICLE clipper, not an EPUB downloader, so it is the wrong path.
- CDP taps are CSS px (dpr 2.75 here); `adb shell input tap` is device px. Convert with `* 2.75`.
- Reader iframes live in a shadow root, so `document.querySelectorAll('iframe')` returns nothing — walk `el.shadowRoot` recursively (scripts `frames.js` / `playbtn.js` in the session scratchpad). FXL scrolled mode stacks all pages, so map an in-iframe button to top-level coords via `iframeRect + btnRect * (iframeRect.width / doc.documentElement.clientWidth)` (scale was 0.44).
- Settings path on mobile: View Options (hamburger, `aria-label="View Options"`) -> `Settings` -> `[data-tab="Control"]` -> `[data-setting-id="settings.control.allowJavascript"] input`. Toggling it recreates the viewer.
- `adb reverse tcp:8765 tcp:8765` reaches a Mac-side server from the phone even while it is VPN'd (not needed in the end).

Layer 1 remains by design: "Allow JavaScript" (Settings -> Behavior -> Security) is off by default and Kotobee renders nothing without it (empty black box); the issue reply should say so.
