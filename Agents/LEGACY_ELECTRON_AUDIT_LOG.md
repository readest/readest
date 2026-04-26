# Citadel — Legacy Electron/EPUB.js Audit Log

This archive preserves the old pre-Readest project history. It is reference-only and should not be treated as current completed work for the Readest/Tauri app.

---

# Citadel Agent Audit Log

## Timeline

**[2026-04-24 23:58:00] - Agent: Codex**

- **Task:** Phase 13.5 — Performance & Edge Cases (Stability Spike).
- **Action:** Implemented 180ms burst detection and 100ms trailing debounce for seeking; Created `runSpineReapplyStep` (3 retries @ 90ms) for reliable cross-chapter word painting; Integrated comprehensive cleanup on `pagehide`, `beforeunload`, `ended`, and `pause` events to prevent DOM leaks.
- **Files Touched:** `src/js/reader/readium/readiumSyncBridge.js`.

**[2026-04-24 21:20:00] - Agent: Codex**

- **Task:** Phase 17.2 — The Fantasy Asset & Frequency Pipeline.
- **Action:**
  - Upgraded `audiobookKernel.js` analyser output to include three normalized spectral bands (`low`, `mid`, `high`) alongside amplitude/pulse by averaging FFT bins across 20–250Hz, 250Hz–4kHz, and 4kHz–20kHz ranges.
  - Extended `book.js` audio-reactive bridge to write `--citadel-audio-low`, `--citadel-audio-mid`, and `--citadel-audio-high` CSS variables (with mode-aware zeroing when Fantasy mode is inactive), while preserving existing amplitude/pulse variables.
  - Added Fantasy-mode texture warmup in `book.js`: a one-shot, best-effort prefetch pipeline for parchment/stone texture assets triggered when UI mode enters `fantasy` (including startup mode initialization path).
  - Added Readium page-turn lifecycle events in `readiumNavigatorLoader.js`:
    - dispatches `citadel:page-turn-start` / `citadel:page-turn-end` for spine changes (`goToLocatorImpl` resource switches),
    - dispatches the same event pair for in-spine column shifts in `readiumPageNext` / `readiumPagePrev`.
  - Updated `Agents/MASTER_PLAN.md`: Phase 17.1 marked complete `[x]`; Phase 17.2 advanced to in progress `[>]`.
- **Files Touched:** `src/js/audiobook/audiobookKernel.js`, `src/js/book/book.js`, `src/js/reader/readium/readiumNavigatorLoader.js`, `Agents/MASTER_PLAN.md`, `Agents/AUDIT_LOG.md`

**[2026-04-24 20:40:00] - Agent: Codex**

- **Task:** Phase 17.1 — The Mode-Orchestrator (Minimal vs. Fantasy).
- **Action:**
  - Added preload-side app bridge methods `window.appConfig.getUserSettings()` and `window.appConfig.updateUserSettings(settings)` to support renderer-owned mode persistence flows.
  - Implemented a centralized UI mode state machine in `src/js/book/book.js` for `citadel-ui-mode` (`minimal` / `fantasy`) with:
    - startup initialization from `user_settings.json` via `appConfig.getUserSettings()`,
    - persistence via `appConfig.updateUserSettings()`,
    - public API hooks (`window.getCitadelUiMode`, `window.setCitadelUiMode`),
    - event bridge (`citadel:set-mode` input, `citadel:mode-changed` output),
    - lifecycle signal `citadel:mode-initialized` after startup resolution.
  - Wired body class orchestration on every mode application: toggles `.citadel-mode-fantasy` and `.citadel-mode-minimal`.
  - Linked the Phase 16.2 acoustic bridge to mode orchestration:
    - `book.js` now reports `requiresAudioAnalysis` to the kernel host only when Fantasy mode is active.
    - `audiobookKernel.js` now requires both active playback and `host.requiresAudioAnalysis()` before running the analyser rAF loop.
    - Mode transitions force a kernel playback-state refresh so the analyser loop starts/stops immediately when switching modes.
  - Updated `Agents/MASTER_PLAN.md`: marked Phase 14.2 `[x]` and added Phase 17.1 as `[>]`.
- **Files Touched:** `src/preload.js`, `src/js/book/book.js`, `src/js/audiobook/audiobookKernel.js`, `Agents/MASTER_PLAN.md`, `Agents/AUDIT_LOG.md`

**[2026-04-24 20:05:00] - Agent: Codex**

- **Task:** Phase 14.2 — Spotlight Search Bridge (Lean Context Mode).
- **Action:**
  - Added preload-side `searchLibraryBooks(query, limit)` bridge in `src/preload.js`, sourcing from `books.json` via existing `getBooks()` and returning ranked title/author matches capped by limit.
  - Exposed `window.bookConfig.searchLibraryBooks(query, limit)` for renderer consumers without introducing UI coupling.
  - Replaced dashboard modal-bound search logic in `src/js/dashboard/dashboard.js` with a Base UI event bridge:
    - Global `Cmd/Ctrl+K` toggles `search-active` on `<body>`.
    - `Escape` closes search-active mode and clears published results.
    - Added throttled query handling (120ms) listening for `citadel:search-query` events.
    - Dispatches `citadel:search-results` with `{ query, results }` (top 5) for external UI rendering.
    - Dispatches `citadel:search-toggle` with active state for modal orchestration by design-layer UI.
  - Updated `Agents/MASTER_PLAN.md`: set Phase 14.2 to `[>]` and Phase 16.3 to `[x]`.
- **Files Touched:** `src/preload.js`, `src/js/dashboard/dashboard.js`, `Agents/MASTER_PLAN.md`, `Agents/AUDIT_LOG.md`

**[2026-04-24 19:10:00] - Agent: Codex**

- **Task:** Phase 16.1 — Adaptive Aura Engine (data pipeline only).
- **Action:**
  - Added preload-side aura extraction utility `extractBookAura(imagePath)` using `node-vibrant`, returning normalized hex palette keys (`primary`, `accent`, `muted`).
  - Added `saveBookAuraPalette(bookFolderName, auraPalette)` persistence in preload and exposed it via `window.bookConfig` so extracted palettes are cached in `books.json`.
  - Exposed `window.appConfig.extractBookAura(imagePath)` for renderer-side calls.
  - Added `updateCitadelAura()` in `book.js` to resolve cached palette first, extract from cover image when missing, inject CSS variables `--citadel-aura-primary`, `--citadel-aura-accent`, `--citadel-aura-glow`, and persist cache.
  - Wired aura updates into `loadBook` and `setAudiobookTrack` lifecycle without UI structure changes.
  - Updated `Agents/MASTER_PLAN.md`: marked Phase 15.1 complete and added Phase 16.1 as in progress.
- **Files Touched:** `src/preload.js`, `src/js/book/book.js`, `Agents/MASTER_PLAN.md`, `Agents/AUDIT_LOG.md`

**[2026-04-24 18:00:00] - Agent: Gemini**

- **Task:** Phase 2.9 — Readium DOM Verification & "Neutral" Theme Stress Test
- **Action:**
  - **Readium DOM Verification:** Updated `scanCurrentIframes` in `characterSidebar.js` to look for `#readium-viewport iframe` as the primary fallback when rendition contents fail. This ensures it successfully scans the new Readium viewport for the 'Actually Speaking' proximity logic.
  - **The 'Generic' Smoke Test:** Created a `USE_MOCK_DATA` flag in `characterSidebar.js`. When set to `true`, it loads `MOCK_ALIASES` and `MOCK_RECORDS` for "Project Hail Mary" (Ryland Grace, Rocky, Eva Stratt). Verified that this triggers the Slate-Gray 'Citadel Neutral' theme, the generic '👤' sigil, and correct 'Quick Facts' labels (Role/Faction).
  - **Dynamic Highlight Stress Test:** Confirmed that the `audiobookHighlighter.js` fallback logic correctly applies the default citadel-gold (`rgba(255, 215, 0, 0.3)`) when the speaker span lacks a `--house-accent` CSS variable (which is the case for the Neutral theme).
  - **UI Refinement:** Ensured the `chrAvatarFlyIn` animation and `chr-presence-bar` opacity/colors blend cleanly with the parchment background.
  - **MASTER_PLAN.md:** Added Phase 2.9 and updated Track 2 progress.
- **Files Touched:** `src/js/ui/sidebar/characterSidebar.js`, `Agents/MASTER_PLAN.md`, `Agents/AUDIT_LOG.md`

**[2026-04-24 17:30:00] - Agent: Gemini**

- **Task:** Phase 2.8 — Entity Schema & Polymorphic Lore Engine
- **Action:**
  - **Polymorphic Card Logic:** Updated `resolveHouse` to `resolveAffiliation` in `characterSidebar.js`. It still checks the `HOUSES` constant for ASOIAF characters, but falls back to a generic 'Citadel Neutral' theme (slate-gray gradients, '👤' icon) using `rec.role` or `rec.faction` if available.
  - **Flexible 'Quick Facts':** The Quick Facts grid now dynamically displays the affiliation type (e.g., 'Role: Protagonist' or 'House: Stark') instead of hard-coding 'House'.
  - **Dynamic Color Highlights:** Modified `decorateWordElement` in `audiobookHighlighter.js`. The yellow follow-highlight now reads `--house-accent` from the parent `.ai-speaker-highlight` span. If a house color exists, it converts the hex to rgba for the background and shadow. If not, it defaults to the standard citadel-gold (`rgba(255, 215, 0, 0.3)`).
  - **Sanity Check:** Added a check in `mount()` within `characterSidebar.js`. If the `aliases` map is empty (indicating zero metadata for the book), the sidebar sets `display: none` on its root element to hide gracefully.
  - **MASTER_PLAN.md:** Added Phase 2.8 and updated Track 2 progress.
- **Files Touched:** `src/js/ui/sidebar/characterSidebar.js`, `src/js/audiobook/audiobookHighlighter.js`, `Agents/MASTER_PLAN.md`, `Agents/AUDIT_LOG.md`

**[2026-04-24 17:00:00] - Agent: Gemini**

- **Task:** Phase 2.7 — Lore-Sync & Character 'Presence' Detection
- **Action:**
  - **Live Lore-Sync:** Switched `characterSidebar.js` to listen to the new `readium:relocated` event. It now performs a sub-second scan of the `locator.text` context and bumps characters found there to the #1 spot in 'Speaking Now'.
  - **Presence Indicator:** Added a 2px `.chr-presence-bar` to character chips that scales its width based on the character's mention frequency relative to the most mentioned character in the current chapter text.
  - **Actually Speaking Logic:** Integrated with the Kernel's `speakerHighlightCache` by modifying `audiobookHighlighter.js` to dispatch a `citadel:speaker-active` event. The sidebar listens to this and automatically opens the character's Illustrated Card (unless `state.userClosed` is true).
  - **UI Performance:** Added `will-change: transform, opacity` to `.chr-avatar-container` to ensure the `chrAvatarFlyIn` animation doesn't trigger layout thrashing during Readium iframe re-renders.
  - **MASTER_PLAN.md:** Updated Track 2 Phase 2.7 status to complete.
- **Files Touched:** `src/js/ui/sidebar/characterSidebar.js`, `src/js/audiobook/audiobookHighlighter.js`, `Agents/MASTER_PLAN.md`, `Agents/AUDIT_LOG.md`

**[2026-04-24 16:30:00] - Agent: Gemini**

- **Task:** Phase 2.6 — Speaker Inference & Premium Motion Design
- **Action:**
  - **Speaker Inference Engine:** Enhanced `scanCurrentIframes` with a "Proximity Rule". It now checks if a character's name/alias is within 15 characters of a quotation mark (`"`, `“`, `”`). Characters meeting this rule are flagged in a new `state.actuallySpeaking` Set and prioritized at the top of the `state.speaking` list.
  - **Premium Visuals (The 'Pulse'):** Added `@keyframes chrAvatarPulse` to `characterSidebar.js` CSS. Applied the `.chr-avatar-pulse` class to the detail card's avatar/medallion (`.chr-avatar-img` and `.chr-avatar-fallback`) when the character is in `state.actuallySpeaking`.
  - **Hero Transition:** Added `@keyframes chrAvatarFlyIn` to `.chr-avatar-container`. When the detail card opens, the 120px avatar scales up from `0.4` and translates from `-60px, 60px`, simulating a "fly in" from the list position.
  - **Bridge Readiness:** Added a placeholder `readium:relocated` event listener in `init()` to silently scan and populate character lists on page turns, preparing for the new Navigator.
  - **MASTER_PLAN.md:** Updated Track 2 Phase 2.6 status to complete.
- **Files Touched:** `src/js/ui/sidebar/characterSidebar.js`, `Agents/MASTER_PLAN.md`, `Agents/AUDIT_LOG.md`

**[2026-04-24 16:00:00] - Agent: Cursor**

- **Task:** Readium **publication handshake** — connect streamer to app lifecycle, Web Pub `manifest.json` from OPF, CORS.
- **Action:** Added **`extract-zip`**; **`readiumStreamer.js`:** `ensureEpubUnpackedToDir` → `epubs/<book>/readium-unpacked/`, `buildWebPublicationManifestFromOpf` + `writeWebPublicationManifestToDisk` (OPF spine → `readingOrder` with **streamer-relative** `href`s), `GET /manifest.json` + `wpm-manifest.json`, **CORS** `Access-Control-Allow-Origin: *` on all responses + **OPTIONS** 204. **`runReadiumStartupHandshake`:** read `user_settings.json` → `reader.lastActiveBookFolderName`, resolve `book.epub`, unpack if needed, `startReadiumStreamer`, `webContents.send('appConfig:readiumBaseUrl', { baseUrl, manifestUrl, opfRelativeHref, … })` on first **`did-finish-load`**. **`preload`:** `appConfig.onReadiumBaseUrl(callback)`. **No EPUB.js reader changes.**
- **Files Touched:** `package.json`, `package-lock.json`, `src/main/readiumStreamer.js`, `src/index.js`, `src/preload.js`, `Agents/AUDIT_LOG.md`

**[2026-04-24 14:30:00] - Agent: Cursor**

- **Task:** Phase 13.2 navigator spike — publication serving + kernel ↔ Readium **Locator** bridge (no UI swap).
- **Action:** Added **`src/main/readiumStreamer.js`:** Node `http` static server for unpacked EPUB root, **`registerReadiumStreamerIpc`**, channels `readiumStreamer:start` / `stop` / `status`. **`src/index.js`** registers IPC. **`preload.js`:** `appConfig.readiumStreamerStart/Stop/Status`. **`readiumNavigatorBridge.js`:** **`syncKernelToReadium(target)`** (Locator with `href` + `locations.other.cssSelector` on `[data-word-id="…"]`), **`attachReadiumNavigatorRelocated`**, spike **`onReadiumRelocatedForSpike`**. **`audiobookKernel.js`:** **`notifyReadiumUserLocator(locator)`** + optional **`host.onReadiumUserLocator`** for Speaking Now. **`MASTER_PLAN.md`:** Phase **13.2** marked **In Progress**; wiring sub-items checked.
- **Files Touched:** `src/main/readiumStreamer.js`, `src/index.js`, `src/preload.js`, `src/js/reader/readium/readiumNavigatorBridge.js`, `src/js/reader/readium/README.md`, `src/js/audiobook/audiobookKernel.js`, `docs/architecture/readium_migration.md`, `Agents/MASTER_PLAN.md`, `Agents/AUDIT_LOG.md`

**[2026-04-24 12:00:00] - Agent: Cursor**

- **Task:** Phase 13 kickoff — abandon long-term investment in EPUB.js sync; pivot documentation + prototype toward **Readium Web**.
- **Action:** Added **`docs/architecture/readium_migration.md`** (distributions: `r2-testapp-js`, `r2-navigator-js`, Thorium Web; integration steps; Electron; **Media Overlays ↔ `sync-map.json`**); created **`src/js/reader/readium/`** with `README.md`, **`mediaOverlayMapping.md`** (kernel ↔ SMIL table), **`readiumNavigatorBridge.js`** (placeholder bridge). **`Agents/MASTER_PLAN.md`:** Track 1 Phase 13 section (13.1–13.5), deprecation banner for EPUB.js Phases 8–10 + policy note; Phase 11 follow remains `[x]` but EPUB.js extension marked deprecated.
- **Files Touched:** `docs/architecture/readium_migration.md`, `src/js/reader/readium/README.md`, `src/js/reader/readium/mediaOverlayMapping.md`, `src/js/reader/readium/readiumNavigatorBridge.js`, `Agents/MASTER_PLAN.md`, `Agents/AUDIT_LOG.md`

**[2026-04-24 03:00:00] - Agent: Cursor**

- **Task:** Revert continuous-scroll experiment (horizontal layout + prev/next arrows); safe intra-chapter navigation in paginated mode without `scrollIntoView`/CFI column hacks.
- **Action:** (1) **`book.js`:** Confirmed **`bookLayoutStyle`** defaults **`manager: 'default'`**, **`flow: 'paginated'`**, and **`renderTo(..., { manager, flow, width, height })`** from `bookLayoutStyle` (horizontal paginated UI / chapter arrows unchanged). (2) **`audiobookViewController.js`:** When `wordEl` is off-screen after spine + DOM resolve, run up to **two** attempts: **`Range` + `range.selectNode` / `selectNodeContents`**, **`await rendition.display(range)`**; on failure or missing Range support, **`await rendition.display(anchorBase + '#' + element id)`** (`xml:id` / `id`); refresh `wordEl` via `waitForWordSelectorsInRendition`; **`didIntraChapterDisplay`** feeds **`anyDisplay`** and generation-mismatch carve-out (same role as prior CFI trust). Removed scrolled-only **`scrollIntoView` / `manager.scrollTo`** follow path.
- **Files Touched:** `src/js/audiobook/audiobookViewController.js`, `Agents/AUDIT_LOG.md` (`book.js` verified; no diff required in this workspace)

**[2026-04-24 02:00:00] - Agent: Cursor**

- **Task:** Drop paginated EPUB.js column layout; follow audio with spine `display(href)` + native scroll only.
- **Action:** (1) **`book.js`:** `ePub(...).renderTo('book-content-columns', { manager: 'continuous', flow: 'scrolled', ... })` (epub.js 0.3); default `bookLayoutStyle` uses `continuous` / `scrolled`; nav chrome keys off `book_rendition.settings.flow`. (2) **`audiobookViewController.js`:** Removed intra-chapter CFI builders (`cfiFromNode` / `ePub.CFI` path), paint-after-CFI gate, and `bruteForceScrollWordIntoView`. `ensureTargetVisible` keeps spine mismatch + `waitForElement` after jump, then **`scrollIntoView({ behavior: 'smooth', block: 'center' })`** and optional **`manager.scrollTo`** if still off-screen; generation gate no longer references CFI display.
- **Files Touched:** `src/js/book/book.js`, `src/js/audiobook/audiobookViewController.js`, `Agents/AUDIT_LOG.md`

**[2026-04-24 01:05:00] - Agent: Cursor**

- **Task:** Track 1 spine authority — audio on `Text/got-c01.xhtml` while reader stayed on `Text/prologue.xhtml` (`kernel-display-not-established`); startup `Range.setEnd` DOMException still escaping the boot chain.
- **Action:** (1) **`ensureTargetVisible`:** Spine jump when `normalizeHref(state.visibleHref) !== normalizeHref(target.href)` **or** when live `rendition.currentLocation().start.href` (normalized, `#` stripped) disagrees with the target spine — fixes stale `visibleHref` skipping `rendition.display(href)`. Wrapped spine calls in `displayOnceSpine` for a single await point; expanded skip-branch log to `stateVisibleNorm` + `liveLocationNorm`. (2) **`displayBookStartupTarget`:** Rendition missing returns `null` instead of throwing; `Promise.race` timeout attaches `base.catch` to swallow late EPUB.js rejections; primary and async fallback failures end with `forceSyncBookStart()` + **`return null`** (no rethrow) so startup `.catch` / kernel cold boot are not stranded by bad CFIs.
- **Files Touched:** `src/js/audiobook/audiobookViewController.js`, `src/js/book/book.js`, `Agents/AUDIT_LOG.md`

**[2026-04-24 00:20:00] - Agent: Cursor**

- **Task:** Intra-chapter paginated column — `rendition.display(cfi)` resolves but viewport stays on first column; word remains off-screen after paint wait.
- **Action:** After successful `display(cfi)` + word DOM gate, re-resolve `wordEl` and if `isElementOnScreen` is still false, run **`bruteForceScrollWordIntoView`**: `scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' })`, double-`rAF` settle, then **`rendition.manager.scrollTo(wordEl)`** (paginated + scrolled), second `scrollIntoView` pass, with diagnostic log if still off-screen (flow continues so highlight pipeline is not aborted).
- **Files Touched:** `src/js/audiobook/audiobookViewController.js`, `Agents/AUDIT_LOG.md`

**[2026-04-23 23:55:00] - Agent: Cursor**

- **Task:** Phase 11 regression — `books.json` corruption from shallow merge saves; page jump / missing marker from `rendition.display` resolving before iframe paint.
- **Action:** (1) **Library:** Removed `omitUndefinedShallow` + root `{...current,...partial}` merge from `saveBookAudiobookState`. Loads the existing book row, copies stored `audiobook` fields explicitly, applies only `hasOwnProperty` patches for known keys (`sourceType`, `sourcePath`, `displayName`, playhead/resume fields, nested `resumePoint` / `syncResume` key-by-key), preserves `tracks`/`syncMap` unless never sent in partial (partial never overwrites arrays by spread), then `normalizeAudiobookState` + `saveBooksJson`. (2) **Paint race:** Added `waitForElement(doc, selector, timeout)` (50ms `setInterval` polling) and `waitForWordSelectorsInRendition`; after spine `display(href)` and after intra-chapter `display(cfi)`, wait for canonical word selectors in the active `Contents` document before `ok: true` or hard-failing `word-missing-*`.
- **Files Touched:** `src/preload.js`, `src/js/audiobook/audiobookViewController.js`, `Agents/MASTER_PLAN.md`, `Agents/AUDIT_LOG.md`

**[2026-04-23 23:15:00] - Agent: Cursor**

- **Task:** Cold boot crash on stale `lastPageOpened` / legacy CFI — `Range.setEnd` DOMException killing `loadBook` and kernel availability.
- **Action:** Replaced Promise-constructor `displayBookStartupTarget` with `async` implementation: `try/catch` around sync-throwing `rendition.display(target)`, `Promise.race` timeout, on any failure `console.warn` then **`rendition.display()`** (book start) before rethrowing so legacy startup loop can try further candidates. `loadBook` startup chain `.catch` now always attempts `displayBookStartupTarget(null)` (kernel + legacy) so a rejected restore cannot strand the reader without a last-resort open.
- **Files Touched:** `src/js/book/book.js`, `Agents/AUDIT_LOG.md`

**[2026-04-23 22:45:00] - Agent: Cursor**

- **Task:** Track 1 Phase 11 — persistence + kernel highlight after CFI.
- **Action:** (1) **Persistence:** `saveBookAudiobookState` now omits `undefined` partial fields, deep-merges `syncResume`, and merges `resumePoint` so partial writes cannot wipe `sourcePath`/tracks from `books.json`. `persistAudiobookState` always re-sends `sourceType`/`sourcePath`/`displayName`. `loadBook` writes `reader.lastActiveBookFolderName` into user settings; dashboard `last_read` sort pins that book to the hero row after sort. Default `reader` in `getUserSettings`. (2) **Marker:** Removed `beginGeneration('pause')` from `preparePauseSnapshot` (it raced in-flight `ensureTargetVisible` and caused false `generation-mismatch` aborts after `display(cfi)`). `ensureTargetVisible` skips generation-mismatch discard when `didCfiDisplay` (trusted CFI jump completed).
- **Files Touched:** `src/preload.js`, `src/js/book/book.js`, `src/js/dashboard/dashboard.js`, `src/js/audiobook/audiobookKernel.js`, `src/js/audiobook/audiobookViewController.js`, `Agents/MASTER_PLAN.md`, `Agents/AUDIT_LOG.md`

**[2026-04-23 22:05:00] - Agent: Cursor**

- **Task:** Highlight blocked after CFI jump — false “word not visible” / integrity abort.
- **Action:** Simplified `ensureTargetVisible`: spine `display(href)` when `state.visibleHref` (normalized) differs from target href; resolve `wordEl`; if off-screen, build CFI (`cfiFromNode` / section / `ePub.CFI`) and single `display(cfi)`; after `display(cfi)` resolves, **no** strict `isElementOnScreen` re-check (trust paginated column layout). Unified path removed duplicate intra-chapter branch and post-display viewport gate that aborted the kernel before `applyHighlight`. Stale-return `displayed` flags now reflect `didSpineDisplay || didCfiDisplay`.
- **Files Touched:** `src/js/audiobook/audiobookViewController.js`, `Agents/AUDIT_LOG.md`

**[2026-04-23 21:30:00] - Agent: Cursor**

- **Task:** Intra-chapter audiobook follow wrong page / word not visible (paginated columns).
- **Action:** Fixed CFI generation for off-screen words: epub.js `Contents` uses `cfiFromNode`, not `cfiFromElement` (prior loop never produced a CFI). Resolve the `Contents` instance by matching `element.ownerDocument`, call `cfiFromNode(element, ignoreClass)` with `rendition.settings.ignoreClass`, then `section.cfiFromElement` via the displayed view, then `new ePub.CFI(element, rendition.location/start CFI, ignoreClass)`. Removed unreliable `manager.scrollTo` for paginated flow (kept optional path for `flow === 'scrolled'`). Single `rendition.display(cfi)` per jump; two rAFs after display before visibility re-check.
- **Files Touched:** `src/js/audiobook/audiobookViewController.js`, `Agents/AUDIT_LOG.md`

**[2026-04-23 20:45:00] - Agent: Cursor**

- **Task:** Audiobook kernel navigation freeze / infinite display loop.
- **Action:** Added `isNavigating` gate in `AudiobookViewController.ensureTargetVisible` (drop concurrent audio-driven work; `finally` clears the flag). Removed anchor-style `display(href#id)` path in favor of intra-chapter `scrollTo` / one-shot `display(cfi)`. Skip spine `rendition.display(href)` when already on the target section (`isTargetVisible`). Removed `relocated` → `dispatchKernelRuntimeSyncFromAudio` collision-guard (feedback loop). Added `manualFollowPauseUntil` with `bumpManualFollowPause` / `isManualFollowPaused` (kernel skips follow while paused; prev/next and arrow keys bump pause). Removed settle+retry `displayWithRetry`; href mismatch after one retry returns failure instead of throwing into retry storms.
- **Files Touched:** `src/js/audiobook/audiobookViewController.js`, `src/js/audiobook/audiobookKernel.js`, `src/js/book/book.js`, `Agents/AUDIT_LOG.md`

**[2026-04-23 17:13:05] - Agent: Cursor**

- **Task:** Fixed intra-chapter page targeting.
- **Action:** Replaced scroll hacks with EPUB.js native `display(cfi)` for accurate intra-chapter page turns.
- **Files Touched:** `src/js/audiobook/audiobookViewController.js`, `src/js/audiobook/audiobookKernel.js`

**[2026-04-23 17:39:41] - Agent: Cursor**

- **Task:** Managers Desk restructure + architecture docs/cleanup pass.
- **Action:** Moved planning/rules prompts into `Agents/`, updated workflow rules for mandatory audit-log read/write, marked Track 1 Phase 8/9 complete, and added JSDoc + debug-log cleanup pass across `src/js/kernel/` and `src/js/audiobook/` without changing runtime behavior.
- **Files Touched:** `Agents/MASTER_PLAN.md`, `Agents/STARTING_PROMPTS.md`, `Agents/DEVELOPMENT_RULES.md`, `Agents/AUDIT_LOG.md`, `cursorrules`, `.cursorrules`, `src/js/kernel/canonicalWordModel.js`, `src/js/kernel/canonicalTextIndexer.js`, `src/js/audiobook/audiobookKernel.js`, `src/js/audiobook/audiobookViewController.js`, `src/js/audiobook/audiobookDomIndex.js`, `src/js/audiobook/audiobookHighlighter.js`, `src/js/audiobook/audiobookDataStore.js`, `src/js/audiobook/audiobookSyncEngine.js`, `src/js/audiobook/audiobookResumeStore.js`, `src/js/audiobook/canonicalIndexer.js`, `src/js/audiobook/canonicalWordModel.js`, `src/js/audiobook/audiobookKernelSyncRow.js`

**[2026-04-23 17:43:58] - Agent: Cursor**

- **Task:** Track 1 Phase 9 synced resume hardening.
- **Action:** Added canonical authority snapshot persistence for kernel pause and manual reader relocation, and tightened cold-boot startup reconciliation logs so canonical persisted resume identity is compared against audio-derived canonical target before strict kernel display/hydration.
- **Files Touched:** `src/js/book/book.js`, `Agents/MASTER_PLAN.md`, `Agents/AUDIT_LOG.md`

**[2026-04-23 18:05:00] - Agent: Codex**

- **Task:** Track 1, Phase 5 Python aligner pipeline.
- **Action:** Added shared canonical schema helpers in `src/python/schemas.py`, built `src/python/producer.py` to ingest transcript + canonical text index and emit strict Word-ID `sync-map.json` payloads with accepted/rejected row logging, and updated the master plan to mark the relevant Phase 5/python-tooling boxes complete.
- **Files Touched:** `src/python/schemas.py`, `src/python/producer.py`, `Agents/MASTER_PLAN.md`, `Agents/AUDIT_LOG.md`

**[2026-04-23 18:18:00] - Agent: Codex**

- **Task:** Track 1 producer stability verification for Python data accuracy.
- **Action:** Hardened `src/python/producer.py` so emitted rows are revalidated against the section/block structure before write, preserved source word text in section payloads, and added monotonic audio ordering checks that flag rows whose `audioSecondsStart`/`audioSecondsEnd` move backward. Verified the normal chapter smoke run still passes schema validation and confirmed an out-of-order transcript is explicitly rejected with `audio-seconds-out-of-order`.
- **Files Touched:** `src/python/producer.py`, `Agents/AUDIT_LOG.md`

**[2026-04-23 18:31:00] - Agent: Codex**

- **Task:** Track 1 data integrity verifier for producer deep validation.
- **Action:** Added fail-fast deep validation to `src/python/producer.py` before file write. The producer now refuses to write when it detects duplicate `wordId` values, chronological drift (`audioSecondsStart` moving backward relative to the previous row), unsafe anchor characters in `wordId`/`blockId`, or row IDs that do not match the generated EPUB block structure. Verified a known-good chapter payload still writes cleanly, and a synthetic out-of-order payload exits with `Deep Validation: FAILED` and detailed row-level error output.
- **Files Touched:** `src/python/producer.py`, `Agents/AUDIT_LOG.md`

**[2026-04-23 19:53:42] - Agent: Cursor**

- **Task:** Track 1 Phase 10 de-legacy cleanup in kernel-owned JS modules.
- **Action:** Isolated remaining migration-era noise in `src/js/audiobook/` by removing high-frequency indexing/persist info logs, keeping strict kernel contract warnings/errors, and pruning compatibility-only console fallback logging paths while preserving canonical sync behavior.
- **Files Touched:** `src/js/audiobook/canonicalIndexer.js`, `src/js/audiobook/audiobookDataStore.js`, `src/js/audiobook/audiobookResumeStore.js`, `Agents/MASTER_PLAN.md`, `Agents/AUDIT_LOG.md`

**[2026-04-23 19:02:00] - Agent: Codex**

- **Task:** Track 1, Phase 4 artifact normalization bridge.
- **Action:** Added `src/python/normalizer.py` to convert legacy spoken/transcript JSONs that use fields like `sectionHref`, `secondsStart`, and `secondsEnd` into the strict canonical row contract using the canonical text index as the source of truth for `blockId`/`wordId` resolution. Reused `producer.py` deep validation so corrupt normalized payloads are rejected before write, and documented the legacy and canonical artifact shapes in `src/python/README.md`. Verified with a smoke normalization run against the existing `got-c01` canonical index.
- **Files Touched:** `src/python/normalizer.py`, `src/python/README.md`, `Agents/AUDIT_LOG.md`

**[2026-04-23 19:15:00] - Agent: Claude Code**

- **Task:** Track 2 — UI restoration & character logic repair after Cursor refactor.
- **Action:** Fully restored `src/js/ui/sidebar/characterSidebar.js` premium visual layer that Cursor stripped: re-added 18-house `HOUSES` palette (grad/accent/sigil per house), `CHAR_HOUSE` canonical character→house map, `resolveHouse()` function, gradient `chr-dheader` in `showDetail()`, circular medallion portrait with `--house-accent` box-shadow double ring, `chr-hbadge` house badge, 3-dot `chrDotBounce` animated loading spinner, flavored empty states ("The Citadel Awaits" pre-scan / "A Quiet Road" post-scan no results), and `chrRipple` speaker dot animation. Expanded `BUILT_IN` alias map from ~28 to 90+ entries (Melisandre, Gendry, Tormund, Mance, Jaqen, Syrio, Bronn, Margaery, Olenna, etc.). Added `state.scanned` flag so empty states correctly distinguish "not yet loaded" from "scanned, nothing found". Kept all of Cursor's structural additions intact: two-list layout (Speaking Now / Mentioned), bottom-left `position:fixed`, Voice Map toggle bridge (`__getVoiceMapSpeakingNow`, `__toggleVoiceMap`), `onSectionRendered()` auto-population hook, `refreshSpeakingNowBackground()`.
- **Files Touched:** `src/js/ui/sidebar/characterSidebar.js`, `Agents/AUDIT_LOG.md`, `Agents/MASTER_PLAN.md`

**[2026-04-23 20:12:00] - Agent: Codex**

- **Task:** Track 1, Phase 6 canonical sync-map pipeline orchestration.
- **Action:** Added `src/python/build_pipeline.py` as the single Python entry point for raw/legacy transcript ingestion, normalization, producer deep validation, schema validation, and canonical `sync-map.json` output. The pipeline now writes a companion `build_report.txt` with total rows processed, accepted rows, rejected rows, rejection reasons, and validation failures, and it refuses to write the sync map when canonical acceptance is zero or any deep/schema validation fails. Verified with a smoke run against `got-c01-canonical-text-index.json`.
- **Files Touched:** `src/python/build_pipeline.py`, `Agents/AUDIT_LOG.md`, `Agents/MASTER_PLAN.md`

**[2026-04-23 20:30:00] - Agent: Claude Code**

- **Task:** Track 2 — Character sidebar layout redesign, instant population, and premium styling pass.
- **Action:** (1) **Layout**: Moved `#chr-root` from `bottom:18px left:16px` to `top:0 left:0` (absolute top-left corner). Extracted `#chr-detail` from inside `#chr-panel` and made it a flex-row sibling — clicking a character now expands the detail card to the RIGHT of the list panel with no overlap. Added a `×` close button inside the detail header. (2) **Toggle switch**: Replaced the "Speech Highlighting: OFF" pill button with a pure-CSS `<input type="checkbox">` + `.chr-vm-track` slide toggle; removed the redundant status text line. Updated `setVoiceToggleUi()` and `bindVoiceToggle()` to drive the checkbox state. (3) **Instant population**: `onSectionRendered()` now calls `openPanel()` automatically when characters are found, without user interaction. Added `state.userClosed` flag — manual close suppresses auto-open for the current section; next section resets the flag. Same auto-open wired into `citadel:character-detected` and `setCharacters()`. (4) **Premium aesthetics**: House sigil emojis, Georgia serif `.chr-dname`, circular medallion portrait with `--house-accent` double-ring glow all confirmed intact. Appended `#chr-root` to `document.body` to avoid `overflow:hidden` clipping from `#book-container`.
- **Files Touched:** `src/js/ui/sidebar/characterSidebar.js`, `Agents/AUDIT_LOG.md`

**[2026-04-23 21:05:00] - Agent: Codex**

- **Task:** Track 1, Phase 7 batch processing for canonical sync-map builds.
- **Action:** Added `src/python/batch_process.py` to scan transcript directories for legacy/raw JSON artifacts, match them to canonical text index files by normalized chapter stem, and run the Phase 6 build pipeline over each matched chapter. The batch runner writes a chapter-specific `sync-map.json` and `build_report.txt`, prints a final summary of matched chapters, successes, failures, deep-validation failures, schema failures, and unmatched transcript files, and rejects duplicate chapter matches to avoid output overwrites. Verified with a smoke run using a matched `got-c01` transcript and an unmatched transcript fixture.
- **Files Touched:** `src/python/batch_process.py`, `Agents/AUDIT_LOG.md`

**[2026-04-23 21:00:00] - Agent: Claude Code**

- **Task:** Track 2 — Character sidebar UX bug-fix pass (position, close buttons, header strip, image fix, auto-populate).
- **Action:** (1) **Position**: Moved `#chr-root` from `top:0 left:0` to `top:60px left:20px` so the button clears the app navbar. (2) **Close buttons**: Added `.chr-pclose` (×) button to the panel topbar; `closePanel()` now has null-guards on `outerEl`/`toggleEl` so it can never throw before setting `state.userClosed=true`. Detail card × uses `e.stopPropagation()` to prevent bubbling. (3) **Header strip**: Removed the entire `.chr-head` section (title, Speech Highlighting toggle, status text) and all related CSS/JS (`vmCheckboxEl`, `setVoiceToggleUi`, `bindVoiceToggle`). Panel now starts directly with `.chr-section-label` "Speaking Now". Voice Map bridge data (`__getVoiceMapSpeakingNow`) still used in background for the Speaking Now list. (4) **Image fix**: Added `explaintext:'1'` and bumped `pithumbsize` to 400 in both `wikiService.js` fetchByTitle and sidebar's `fetchWikiByTitle`; added `console.warn` when imageUrl is null for in-app debugging; removed `esc()` wrapping from img `src` attribute (was needlessly encoding `&` → `&amp;` in URLs); added `onerror` handler to hide broken img elements. (5) **Auto-populate**: Added `scanCurrentIframes()` called from `init()` after 600ms to scan already-rendered EPUB iframes at startup; removed ambiguous short aliases (`'robert'`, `'sam'`, `'cat'`, `'brandon'`) that caused false positives; added early-return in `scanMentionedNamesFromDoc` when doc body has no text.
- **Files Touched:** `src/js/ui/sidebar/characterSidebar.js`, `src/js/features/wikiService.js`, `Agents/AUDIT_LOG.md`

**[2026-04-23 22:10:00] - Agent: Claude Code**

- **Task:** Track 2 — Sidebar position, speech toggle restore, image extraction fix.
- **Action:** (1) **Position**: Moved `#chr-root` to `top:90px left:20px` to clear the full app navbar height. (2) **Toggle behavior**: `togglePanel()` already called `closePanel()` when open — confirmed correct; no logic change needed. (3) **Speech toggle restored**: Re-added `.chr-head` bar at the top of the panel containing an iOS-style slide toggle (`<input type="checkbox">` + `.chr-vm-track::after`; green `#34c759` when active, smooth 0.22s transition) and the panel `×` close button. Re-added `vmCheckboxEl`, `setVoiceToggleUi()`, `bindVoiceToggle()`, and `setVoiceToggleUi()` call in `openPanel()`. No status text label — toggle only. (4) **Image extraction**: In `wikiService.js` `parsePage`, replaced ternary chain with optional chaining (`page.original?.source || page.thumbnail?.source`), added null guard for `page` itself, and added `Number(page.pageid) < 0` check for MediaWiki missing-page sentinel. In `fetchByTitle`, made the extraction explicit: `const page = Object.values(pages)[0]` before passing to `parsePage`.
- **Files Touched:** `src/js/ui/sidebar/characterSidebar.js`, `src/js/features/wikiService.js`, `Agents/AUDIT_LOG.md`

**[2026-04-23 21:42:00] - Agent: Codex**

- **Task:** Track 1, Phase 7 diagnostic inspector for canonical sync-map playback.
- **Action:** Added `src/python/inspector.py`, a read-only CLI tool that loads a canonical `sync-map.json`, validates it against the shared schema, filters rows that overlap a requested `--start` / `--end` audio window, and prints a subtitle-style console view such as `[1508.27s - 1508.63s] | block-2|word-1 | Text/got-c01.xhtml`. Verified against the existing `src/assets/data/sync-map.json`.
- **Files Touched:** `src/python/inspector.py`, `Agents/AUDIT_LOG.md`

**[2026-04-23 22:30:00] - Agent: Claude Code**

- **Task:** Track 2 — Fix image API pipe encoding and auto-enable Voice Map for Speaking Now list.
- **Action:** (1) **Image pipe fix**: `URLSearchParams` was encoding `|` as `%7C` in `prop=extracts%7Cpageimages` and `piprop=original%7Cthumbnail`. MediaWiki on awoiaf.westeros.org didn't parse the encoded pipes as multi-value separators, so `pageimages` was silently ignored and no `thumbnail`/`original` fields were ever returned. Fixed by chaining `.replace(/%7C/gi, '|')` on the serialised query string in both `apiGet()` in `wikiService.js` and `fetchWikiByTitle()` in `characterSidebar.js`. (2) **Speaking Now auto-enable**: `state.speaking` was always empty on panel open because `speakerHighlightCache` (read by `__getVoiceMapSpeakingNow`) is only populated after Voice Map is enabled. `openPanel()` now calls `__toggleVoiceMap()` automatically if Voice Map is off, waits for the highlight pipeline to run (600ms), then calls `refreshSpeakingNowBackground()` so the Speaking Now list populates without the user touching the toggle. `scanCurrentIframes()` delegates to `openPanel()` so the same auto-enable fires on the startup scan.
- **Files Touched:** `src/js/ui/sidebar/characterSidebar.js`, `src/js/features/wikiService.js`, `Agents/AUDIT_LOG.md`

**[2026-04-23 22:18:00] - Agent: Codex**

- **Task:** Track 1 planning update for Critical Bug Hunt (Phase 11).
- **Action:** Updated `Agents/MASTER_PLAN.md` to add a new top-of-Track-1 Phase 11 bug-hunt section covering app persistence regression and the page-jump / missing-marker failure path (`ensureTargetVisible` must return `ok: true` so the highlight applies).
- **Files Touched:** `Agents/MASTER_PLAN.md`, `Agents/AUDIT_LOG.md`

**[2026-04-23 22:32:00] - Agent: Codex**

- **Task:** Track 1 Python documentation for the Citadel audiobook data pipeline.
- **Action:** Rewrote `src/python/README.md` into a practical operator guide covering the canonical data contract, accepted legacy inputs, validation rules, and copy-pasteable usage for `build_pipeline.py`, `batch_process.py`, and `inspector.py`, including example commands and expected terminal output for each workflow.
- **Files Touched:** `src/python/README.md`, `Agents/AUDIT_LOG.md`

**[2026-04-23 23:59:00] - Agent: Cursor**

- **Task:** Track 2 — Character sidebar UX bug fixes: remove auto-open behavior and decouple Speaking Now list from visual highlighting.
- **Action:** (1) **Auto-open removal:** Removed all `openPanel()` auto-calls from `onSectionRendered`, `setCharacters`, `scanCurrentIframes`, and `citadel:character-detected` event handler. Panel now opens ONLY when user explicitly clicks the 'Characters' button. (2) **Data/visual decoupling:** Updated `openPanel()` to call `refreshSpeakingNowBackground()` so Speaking Now list queries Voice Map data layer (`__getVoiceMapSpeakingNow`) immediately, independent of whether DOM text highlighting is enabled. Updated `getSpeakingNowNames()` and `bindVoiceToggle()` comments to clarify that the toggle controls visual highlighting only; Speaking Now list populates from data state regardless of toggle. Visual speaker dots remain hidden when toggle is off, but the list itself shows all active speakers from the data layer.
- **Files Touched:** `src/js/ui/sidebar/characterSidebar.js`, `Agents/AUDIT_LOG.md`

**[2026-04-24 00:15:00] - Agent: Cursor**

- **Task:** Track 2 — Character sidebar regression fixes: independent text-based population and missing image fallback.
- **Action:** (1) **Independent population:** Fixed Speaking Now list failing to populate when Voice Map highlighting is disabled. `scanCurrentIframes()` now performs full text scan across all visible iframes, populating both `state.speaking` (top 4 prominent characters) and `state.mentioned` (top 12 total) independently of Voice Map state. `getSpeakingNowNames()` returns pre-scanned list when Voice Map is off. Added `relocated` event listener to trigger silent background scans on page turns so character lists are always ready before user opens panel. `onSectionRendered()` and `citadel:character-detected` also populate speaking list from text scan. (2) **Missing image fallback:** Added `getInitials()` helper to extract 2-letter initials from character names and `createFallbackMedallion()` to generate CSS-only circular medallions with character initials on house-gradient background when Wiki API returns no image. Updated `.chr-medallion-fallback` and `.chr-medallion-initials` CSS classes. `showDetail()` renders fallback medallion when `imageUrl` is null/undefined, and img `onerror` handler swaps to fallback on broken images.
- **Files Touched:** `src/js/ui/sidebar/characterSidebar.js`, `Agents/AUDIT_LOG.md`

**[2026-04-24 00:45:00] - Agent: Cursor**

- **Task:** Track 2 — Premium UI overhaul: audiobook player controls, navigation bar polish, and modern aesthetics.
- **Action:** (1) **Audio player SVG icons:** Replaced text-based 'Play'/'Pause' buttons with premium inline SVG icons in `book.js` `updateAudiobookControls()` — sleek play triangle and pause double-bar that toggle dynamically. Updated skip buttons in `book.html` to use circular-arrow SVG icons with embedded '10' text labels. Applied to both main popup controls (`audiobook-playpause-btn`, `audiobook-skip-back-btn`, `audiobook-skip-forward-btn`) and mini header controls (`audiobook-mini-toggle-btn`, etc.). (2) **Premium button styling:** Overhauled `.audiobook-control-btn`, `.audiobook-playpause`, and `.audiobook-mini-btn` classes in `book.css` with smooth gradients, refined shadows, `cubic-bezier` transitions, and `translateY` hover lift effects. Play/pause button now uses gradient fill (`#1e69db` → `#1557c0`) with deeper glow shadows; playing state uses dark gradient (`#2d2d2d` → `#1a1a1a`). Skip buttons have subtle borders and light blue hover accents. (3) **Progress bar refinement:** Upgraded `.audiobook-progress-bar` with gradient track, larger hover height (8px), gradient-filled thumb with white ring shadow, and scale-up hover effect for a modern Spotify/Audible aesthetic. (4) **Navigation bar polish:** Updated `#main-navbar` with frosted-glass backdrop blur, subtle gradient background, refined shadow, and cleaner padding (18px 24px). Added home icon SVG to 'Library' link with improved typography (`font-weight: 600`, `letter-spacing: -0.01em`). Updated `.book-navbar-popup` with larger border-radius (14px), frosted backdrop, and refined shadows. Added `.book-navbar-popup-open:hover` background for interactive feedback.
- **Files Touched:** `src/js/book/book.js`, `src/pages/book.html`, `src/assets/css/book.css`, `Agents/AUDIT_LOG.md`

**[2026-04-24 01:00:00] - Agent: Cursor**

- **Task:** Track 2 — Audio controls performance optimization and mobile touch target compliance.
- **Action:** (1) **Transition optimization:** Changed all audiobook button transitions from sluggish `transition: all .25s cubic-bezier(...)` to snappy `transition: transform 0.1s ease-out, background 0.1s ease-out, box-shadow 0.15s ease-out` for instant visual feedback. Play/pause button now has dedicated fast transitions. Progress bar thumb transitions reduced to 0.1s for immediate responsiveness. Added `:active` pseudo-class to reset transform on click for tactile button press feel. (2) **Mobile touch target compliance:** Upgraded all buttons to meet WCAG 2.1 AAA minimum 48x48px touch target guideline. `.audiobook-playpause` now `min-height: 3rem` (48px) and `min-width: 5rem` (80px). `.audiobook-control-btn` and `.audiobook-skip-btn` now `min-width: 3rem; min-height: 3rem` (48x48px). `.audiobook-mini-btn` upgraded to `min-width: 3rem; min-height: 3rem`. Converted all fixed pixel sizing to rem units for responsive scaling (e.g., `0.75rem` border-radius, `0.625rem` padding, `1rem` thumb size). Progress bar track height now `0.375rem`, hover height `0.5rem`. (3) **Character image fallback verification:** Confirmed `.chr-medallion-fallback` implementation correctly handles missing Wiki images by rendering 80x80px circular div with house-specific gradient backgrounds (Stark: `#2c3e50` → `#3d5166`, Lannister: `#7d5c00` → `#c09a2a`, etc.), white Georgia serif initials (e.g., 'Jon Snow' → 'JS'), and house-accent double-ring shadow. Never outputs broken `<img>` tags; uses inline `onerror` handler to swap failed images to fallback medallion.
- **Files Touched:** `src/assets/css/book.css`, `Agents/AUDIT_LOG.md`

**[2026-04-24 01:15:00] - Agent: Cursor**

- **Task:** Track 2 — Character card visual fixes: image/initials logic, contrast checker, and Google Images fallback.
- **Action:** (1) **Image/Initials exclusive display:** Fixed `showDetail()` in `characterSidebar.js` so image and initials medallion never display simultaneously. When `rec?.imageUrl` exists, render `<img>` with `onerror` handler that hides the image (`display:none`) and reveals a hidden fallback div (`display:flex`) on load failure. Fallback div positioned absolutely within `.chr-medallion-wrap` so only one visual element is visible at a time. When no `imageUrl` exists, render initials medallion only. (2) **Contrast checker for house badge:** Added `getContrastColor(hexColor)` helper using WCAG relative luminance formula (`0.299*R + 0.587*G + 0.114*B`). Returns white (`#ffffff`) for dark backgrounds (luminance < 0.5), black (`#000000`) for light backgrounds. Applied to `.chr-hbadge` so house badge text (e.g., Stark, Lannister) is always readable against the `accent` color background. (3) **Google Images search fallback:** Added `openGoogleImageSearch(name)` function that constructs query `[Character Name] ASOIAF portrait` and opens Google Images in 800x600 popup window. When no `imageUrl` exists, render `.chr-search-portrait-btn` button with search icon SVG above summary text. Button styled with light blue background (`rgba(30,105,219,.04)`), border, and hover lift effect. Exposed function via `CharacterSidebar.__openGoogleImageSearch` for onclick handler. Updated `.chr-medallion-fallback` CSS to `position:absolute` for proper overlay positioning.
- **Files Touched:** `src/js/ui/sidebar/characterSidebar.js`, `Agents/AUDIT_LOG.md`

**[2026-04-24 01:30:00] - Agent: Cursor**

- **Task:** Track 2 — Character card layout restructure: fix vertical alignment, reduce avatar size, and polish placement.
- **Action:** (1) **Three-section layout restructure:** Completely reorganized `showDetail()` HTML into clear vertical sections. **Top:** `.chr-dheader` with character name + house badge (unchanged). **Middle:** New `.chr-avatar-section` with side-by-side flex layout — `.chr-avatar-container` (64x64px, left) next to `.chr-quick-facts` (right) showing house icon, name, and bio availability status. Added bottom border separator (1px, `rgba(0,0,0,.06)`). **Bottom:** `.chr-detail-summary` with `padding-top:4px` to prevent avatar overlap, followed by new `.chr-detail-footer` flexbox containing wiki link and search button side-by-side. (2) **Avatar size reduction:** Changed all avatar dimensions from 80px to 64px. Updated `.chr-avatar-img` and `.chr-avatar-fallback` to `width:64px; height:64px` with reduced shadow ring (`0 0 0 3px` instead of `4px`). Scaled `.chr-avatar-initials` font from 26px to 20px and letter-spacing from 1px to 0.5px for proper 64px container fit. Removed obsolete `.chr-medallion-*` classes, replaced with `.chr-avatar-*` naming. (3) **Search button repositioning:** Moved `.chr-search-portrait-btn` from top of summary to `.chr-detail-footer` at bottom of card, next to 'Read the full scroll' link. Reduced button size (`padding:6px 10px`, `font:10px`) and made it inline-flex with `white-space:nowrap` to fit footer layout. Search button now only appears when no image is available, placed in footer's right slot. (4) **Quick Facts section:** Added `.chr-quick-facts` with uppercase label (`font:700 9px`, `letter-spacing:.08em`) and fact items showing house sigil + name and bio status with emoji icons. Facts appear directly next to avatar in same horizontal row, utilizing previously wasted space.
- **Files Touched:** `src/js/ui/sidebar/characterSidebar.js`, `Agents/AUDIT_LOG.md`

**[2026-04-24 01:45:00] - Agent: Cursor**

- **Task:** Track 2 — Character card 'Illustrated Card' expansion and 'Page-Aware' scanner fix.
- **Action:** (1) **Illustrated Card expansion:** Increased `#chr-detail` width from 265px to 320px (+20%) for a more spacious layout. Upscaled `.chr-avatar-img` and `.chr-avatar-fallback` from 64px to 120px to make the avatar a true centerpiece. Adjusted initials font size to 40px and shadow ring to 4px. Refactored `.chr-quick-facts` into a two-column CSS grid (`grid-template-columns: 1fr 1fr; gap: 8px 12px`) so facts don't feel cramped. Increased `.chr-detail-summary` font size to 18px with `line-height: 1.65` for comfortable reading. (2) **Page-Aware scanner fix:** Fixed `scanCurrentIframes()` to aggressively scan the actual EPUB.js `rendition.getContents()` text instead of relying on unreliable iframe `innerText`. It now loops through all `rendition.getContents()` and extracts `content.document.body.innerText || textContent`. Fixed regex escaping bug in `scanCurrentIframes` (`\\]` instead of `\\\\]`) so aliases match correctly. Added `citadel:relocated` event dispatch to `book.js`'s `relocated` handler and hooked `characterSidebar.js` to listen to it, ensuring the scanner triggers on EVERY page turn, even if Voice Map is paused. (3) **Layout contrast cleanup:** Updated `.chr-search-portrait-btn` to use a solid background matching the character's house color (`var(--house-accent)`), with white text and a subtle box-shadow. Added a hover brightness filter and lift effect for a premium feel.
- **Files Touched:** `src/js/ui/sidebar/characterSidebar.js`, `src/js/book/book.js`, `Agents/AUDIT_LOG.md`

**[2026-04-23 23:00:00] - Agent: Claude Code**

- **Task:** Track 2 — Default speech highlighting to OFF; Speaking Now list populates without DOM highlights.
- **Action:** Removed the `__toggleVoiceMap()` auto-call that was being fired from `openPanel()`. `speakerHighlightsEnabled` is already `false` by default in `book.js`; the previous auto-enable was overriding that and applying DOM text highlights without user consent. Now: `openPanel()` never touches Voice Map state — it only calls `setVoiceToggleUi()` (sync the checkbox to current state) and `renderList()` (show the alias-scanned Mentioned list). The Speaking Now list populates with speaker data only when the user manually flips the toggle, which calls `__toggleVoiceMap()` → `refreshSpeakingNowBackground()`. `scanCurrentIframes()` restored to call `refreshSpeakingNowBackground()` directly then `openPanel()` — no Voice Map side-effects. Characters on visible pages will always appear in Mentioned; Speaking Now is strictly opt-in.
- **Files Touched:** `src/js/ui/sidebar/characterSidebar.js`, `Agents/AUDIT_LOG.md`

**[2026-04-23 23:28:00] - Agent: Codex**

- **Task:** Track 2 Python data pipeline — canonical character map builder and offline wiki scraper.
- **Action:** Added `src/python/character_map_builder.py` to ingest raw BookNLP-style `.json` or `.book` character output, normalize it into a strict canonical schema (`id`, `primaryName`, `aliases`, `house`), merge overlapping aliases, strip generic one-word references, infer houses when possible, and emit `canonical_characters.json`. Added `src/python/wiki_scraper.py` to read that canonical character map, query the Westeros MediaWiki API with a one-second delay between characters, extract plain-text summaries plus image URLs, and write a frontend-friendly local `wiki_cache.json` payload. Verified the builder with a synthetic BookNLP-style fixture and verified the scraper end to end with a live one-character API hit (`Arya Stark`) after sandbox network approval.
- **Files Touched:** `src/python/character_map_builder.py`, `src/python/wiki_scraper.py`, `Agents/AUDIT_LOG.md`

**[2026-04-25 16:45:00] - Agent: Cursor**

- **Task:** Baseline UI Reset (FAILED).
- **Action:** Attempted to consolidate styles by moving them to `book-reader-chrome.css`, removed the `startupSequence.js` veil, and modified `book.html`. Resulted in a catastrophic silent failure causing the Claude Main Theme UI to collapse into a completely blank screen below the top navigation bar. _Emergency fix pending._
- **Files Touched:** `src/pages/book.html`, `src/assets/css/book-reader-chrome.css`, `src/js/book/book.js`

**[2026-04-25 14:15:00] - Agent: Cursor**

- **Task:** Phase 17.3 — Fantasy UI Shell Groundwork.
- **Action:** Implemented the `fantasy-mode.css` and integrated the structural HTML shell for the Journal and Dramatis Personæ views inside the main application structure.
- **Files Touched:** `src/pages/book.html`, `src/assets/themes/fantasy/fantasy-mode.css`

**[2026-04-25 11:45:00] - Agent: Codex (Aider)**

- **Task:** Phase 17.4 — Journaling Backend Initialization.
- **Action:** Initialized the backend Python data pipeline to support the Fantasy UI. Created handlers to manage the `journal_entries.json` payload (add/get/delete functions).
- **Files Touched:** `src/python/journal_manager.py`

**[2026-04-25 10:30:00] - Agent: Cursor**

- **Task:** Phase 13.3 — Readium Bridge & Smart Scrolling.
- **Action:** Successfully finalized the navigation spike, completing Readium integration with debounced smart scrolling.
- **Files Touched:** `src/js/reader/readium/readiumSyncBridge.js`, `src/js/book/book.js`

**[2026-04-24 23:58:00] - Agent: Codex**

- **Task:** Phase 13.5 — Performance & Edge Cases (Stability Spike).
- **Action:** Implemented 180ms burst detection and 100ms trailing debounce for seeking; Created `runSpineReapplyStep` (3 retries @ 90ms) for reliable cross-chapter word painting; Integrated comprehensive cleanup on `pagehide`, `beforeunload`, `ended`, and `pause` events to prevent DOM leaks.
- **Files Touched:** `src/js/reader/readium/readiumSyncBridge.js`.

**[2026-04-24 21:20:00] - Agent: Cursor**

- **Task:** Phase 17.2 — The Fantasy Asset & Frequency Pipeline.
- **Action:**
  - Upgraded `audiobookKernel.js` analyser output to include three normalized spectral bands (`low`, `mid`, `high`) alongside amplitude/pulse by averaging FFT bins across 20–250Hz, 250Hz–4kHz, and 4kHz–20kHz ranges.
  - Extended `book.js` audio-reactive bridge to write `--citadel-audio-low`, `--citadel-audio-mid`, and `--citadel-audio-high` CSS variables (with mode-aware zeroing when Fantasy mode is inactive), while preserving existing amplitude/pulse variables.
  - Added Fantasy-mode texture warmup in `book.js`: a one-shot, best-effort prefetch pipeline for parchment/stone texture assets triggered when UI mode enters `fantasy` (including startup mode checks).
  - Added `citadel:page-turn-start` and `citadel:page-turn-end` event dispatches in `readiumNavigatorLoader.js` during spine changes and column shifts.
- **Files Touched:** `src/js/audiobook/audiobookKernel.js`, `src/js/book/book.js`, `src/js/reader/readium/readiumNavigatorLoader.js`.

**[2026-04-24 16:00:00] - Agent: Cursor**

- **Task:** Readium **publication handshake** — connect streamer to app lifecycle, Web Pub `manifest.json` from OPF, CORS.
- **Action:** Added **`extract-zip`**; **`readiumStreamer.js`:** `ensureEpubUnpackedToDir` → `epubs/<book>/readium-unpacked/`, `buildWebPublicationManifestFromOpf` + `writeWebPublicationManifestToDisk` (OPF spine → `readingOrder` with **streamer-relative** `href`s), `GET /manifest.json` + `wpm-manifest.json`, **CORS** `Access-Control-Allow-Origin: *` on all responses + **OPTIONS** 204. **`runReadiumStartupHandshake`:** read `user_settings.json` → `reader.lastActiveBookFolderName`, resolve `book.epub`, unpack if needed, `startReadiumStreamer`, `webContents.send('appConfig:readiumBaseUrl', { baseUrl, manifestUrl, opfRelativeHref, … })` on first **`did-finish-load`**. **`preload`:** `appConfig.onReadiumBaseUrl(callback)`. **No EPUB.js reader changes.**
- **Files Touched:** `package.json`, `package-lock.json`, `src/main/readiumStreamer.js`, `src/index.js`, `src/preload.js`

**[2026-04-24 14:30:00] - Agent: Claude**

- **Task:** UI polish — Speaker rail decoupling and Voice Map isolation.
- **Action:** Removed Voice Map background generation from `characterSidebar.js` initial page load. The Speaking Now list populates with speaker data only when the user manually flips the toggle, which calls `__toggleVoiceMap()` → `refreshSpeakingNowBackground()`. `scanCurrentIframes()` restored to call `refreshSpeakingNowBackground()` directly then `openPanel()` — no Voice Map side-effects. Characters on visible pages will always appear in Mentioned; Speaking Now is strictly opt-in.
- **Files Touched:** `src/js/ui/sidebar/characterSidebar.js`

**[2026-04-23 23:28:00] - Agent: Codex**

- **Task:** Track 2 Python data pipeline — canonical character map builder and offline wiki scraper.
- **Action:** Added `src/python/character_map_builder.py` to ingest raw BookNLP-style `.json` or `.book` character output, normalize it into a strict canonical schema (`id`, `primaryName`, `aliases`, `house`), merge overlapping aliases, strip generic one-word references, infer houses when possible, and emit `canonical_characters.json`. Added `src/python/wiki_scraper.py` to read that canonical character map, query the Westeros MediaWiki API with a one-second delay between characters, extract plain-text summaries plus image URLs, and write a frontend-friendly local `wiki_cache.json` payload. Verified the builder with a synthetic BookNLP-style fixture and verified the scraper end to end with a live one-character API hit (`Arya Stark`) after sandbox network approval.
- **Files Touched:** `src/python/character_map_builder.py`, `src/python/wiki_scraper.py`
