# Readest Project Memory

## Key Reference Documents
- [Bug Fixing Patterns](bug-patterns.md) — bug categories, root causes, fix strategies
- [CSS & Style Fixes](css-style-fixes.md) — EPUB CSS overrides + style.ts pipeline
- [TTS Fixes](tts-fixes.md) — TTS architecture and bug patterns
- [Layout & UI Fixes](layout-ui-fixes.md) — safe insets, z-index, platform UI
- [Platform Compat Fixes](platform-compat-fixes.md) — Android/iOS/Linux/macOS bugs
- [Annotator & Reader Fixes](annotator-reader-fixes.md) — highlight, selection, a11y

## Safety & Security
- [In-place delete wiped originals](in-place-delete-wiped-originals.md) — never `fs.removeFile` an `external` source; only managed copy + sidecars
- [Backup zip Windows paths (#4703)](backup-windows-zip-paths-4703.md) — `\` entry names broke restore; normalize separators at cross-platform boundaries
- [download_file scope Android (#4639)](download-file-scope-android-regression.md) — strict `is_allowed` broke Android downloads; fix = `app.path()` base-dir membership
- [Security advisories 2026-06](security-advisories-web-2026-06.md) — 4 GHSA in #4638 (OPDS SSRF, storage key, Stripe userId) + #4639 transfer_file.rs

## Paginator & Scroll
- [Reading ruler line-aware](reading-ruler-line-aware.md) — snaps to real lines; drop tall block boxes; iframe frame-offset map
- [TOC expand + auto-scroll](toc-expand-and-autoscroll.md) — #4059 collapse-default; dynamic expansion breaks scroll-to-current
- [BooknoteView auto-scroll (#4352)](booknote-view-autoscroll-4352.md) — reload via `initialized` ref, tab via `initialTopMostItemIndex`
- [TOC current-position row](toc-current-position-row.md) — synthetic row under active item; insert AFTER so flatItems index stays valid
- [Swipe page-turn bg flash](paginator-swipe-bg-flash.md) — static `#background`; sliding per-view `computeBackgroundSegments` synced per-rAF
- [Paginated texture occlusion (#4399)](paginated-texture-occlusion-4399.md) — opaque `#background` occludes texture; `hasTexture ? '' : fallbackBg`
- [Background overflows column (#4394)](paginator-gutter-bleed-asymmetry-4394.md) — bg bled into gutter; clamp segments to `[containerStart,containerEnd]`
- [Inline-block column overflow](inline-block-column-overflow.md) — inline-block body can't fragment → clipped; `#demoteUnfragmentableBoxes`
- [FXL fit-width scroll reset (#4683)](fixed-layout-paginated-scroll-reset-4683.md) — WebKit scrollTop not reset on turn; `computePaginatedScroll` + `pageTurn`
- [PDF spread 1px seam (#4587)](pdf-spread-canvas-seam-4587.md) — fractional dpr truncates bitmap; pin `canvas.style.{w,h} = viewport.{w,h}`
- [PDF scrolled wheel double (#4727)](pdf-scroll-mode-wheel-double-4727.md) — manual `scrollBy` on top of native chaining; drop it
- [Scrolled header title center (#4436)](scrolled-header-title-center-4436.md) — return view covering `renderedStart + size/2`, not topmost sliver
- [Duokan fullscreen cover scroll](duokan-fullscreen-cover-scroll.md) — #4379 absolute cover collapses in scroll; gate on `this.#column`

## Critical Files (Most Bug-Prone)
- `src/utils/style.ts` — central EPUB CSS transformation hub
- `packages/foliate-js/paginator.js` — page layout, image sizing, backgrounds
- `src/services/tts/TTSController.ts` — TTS state machine, section tracking
- `src/hooks/useSafeAreaInsets.ts` — safe area inset management
- `src/app/reader/components/FoliateViewer.tsx` — reader view orchestration
- `src/app/reader/components/annotator/Annotator.tsx` — annotation lifecycle

## Sync Notes
- [Grimmory native sync](grimmory-native-sync.md) — Booklore-fork sync research; built then REVERTED ("not ready"); official koplugin maps id by ISBN/ASIN + progress via koreader-hash endpoint; OPDS link carries bookId+fileId
- [KOSync CFI spine resolution](kosync-cfi-spine-resolution.md) — convert via the CFI's own spine, never `new XCFI(primaryDoc, primaryIndex)`
- [Empty-start CFI sync](empty-start-cfi-sync.md) — skip-link malformed CFI; `isMalformedLocationCfi` → discard synced value
- [Custom fonts vanish on sync (#4410)](custom-fonts-reincarnation-4410.md) — CRDT remove-wins; re-import needs `reincarnation` token
- [koplugin note deletion sync](koplugin-note-deletion-sync.md) — `recordDeletion` tombstone; signal = `index_modified < 0`
- [koplugin stats sync (#4666)](koplugin-stats-sync.md) — statistics.sqlite3 delta; 3-bug chain (LuaSettings, required, optional_params)
- [Statusless books re-pin top (#4677)](sync-statusless-book-rebump-4677.md) — `undefined`≠server `null` rewrites updated_at; fix `(a??null)!==(b??null)`
- [Pull cursor via synced_at (#4678)](sync-synced-at-cursor-4678.md) — books `synced_at` + BEFORE trigger; superset ⇒ old clients OK
- [KOSync connect() false-positive (#4692)](kosync-connect-false-positive-4692.md) — any 2xx HTML accepted as login; validate koreader JSON

## Build, Testing & CI
- [format:check separate gate](verify-format-check-gate.md) — `pnpm lint` ≠ formatter; `pnpm format:check` own gate, run before push
- [Android CDP e2e lane](android-cdp-e2e-lane.md) — `pnpm test:android` adb+CDP; MediaStore VIEW transient open; CI KVM emulator
- [CDP Android WebView profiling](cdp-android-webview-profiling.md) — adb+CDP JS probes in live app; locked-device freezes fetch
- [Tauri Rust↔JS parser parity](tauri-parser-parity-tests.md) — #4369 native parser cross-check; `dcterms:modified`→`published`
- [TTS browser e2e harness](tts-browser-e2e-harness.md) — real foliate-view; seed `settings.globalViewSettings` or getMergedRules crashes
- [TTS paragraph+RSVP sync (#3235)](tts-sync-paragraph-rsvp-3235.md) — TTS-is-clock; highlight on overlay CLONE via CSS Custom Highlight API
- [fastlane App Store](fastlane-apple-appstore-submission.md) — keep `APPLE_API_KEY_PATH` OUT of macOS build env or Tauri double-notarizes
- [Turbopack cache OOM (#4619)](turbopack-build-cache-oom-docker-standalone.md) — partial cache → freeze; standalone gated on `BUILD_STANDALONE`
- [Deps override workflow](deps-security-overrides-workflow.md) — overrides in `pnpm-workspace.yaml`; tauri-plugins separate submodule w/ age gate
- [pdfjs vendor wasm](pdfjs-vendor-wasm-decoders.md) — scanned PDFs blank in CI; pdfjs 5.7 moved JBIG2 to `jbig2.wasm`; copy `wasm/*`
- [CI/PR delivery + push keepalive](ci-pr-delivery-and-push.md) — temp-index plumbing; SSH `ServerAliveInterval`; `--no-verify` once hook passed

## Platform Compat
- [Android hyphen selection (#1553)](android-hyphen-selection-bounds-1553.md) — Blink paints start handle on last hyphen; repair anchor + custom handles
- [NativeFile vs RemoteFile I/O](android-nativefile-remotefile-io.md) — NativeFile slow; RemoteFile can't replace (asset Range broken); handle-reuse 2.3×
- [Window-state sanitizer (#4398)](window-state-sanitize-4398.md) — invalid `.window-state.json` crashes WebView2; sanitizer plugin before window-state
- [Android Open-with intent (#4521)](android-open-with-intent-flow.md) — VIEW=transient→reader, SEND=library; Telegram fails cold-start + foreign-file read
- [Dict lookup browser hijack (#4559)](dict-lookup-browser-hijack-4559.md) — missing `<queries>` ACTION_PROCESS_TEXT sdk36; filter browsers in `decideLookupDispatch`
- [Large-PDF OOM range flood (#3470)](pdf-oom-range-flood-3470.md) — makePDF fires all ranges un-awaited → OOM; MAX_CONCURRENT_RANGES=6
- [Android themed icon (#4733)](android-themed-icon-4733.md) — `tauri icon` emits no monochrome → force-commit; tint=SRC_IN, negative-space gap

## Reader Features & UI
- [Instant Highlight ate tap/swipe (Android)](instant-highlight-tap-paginate.md) — `handlePointerDown` preventDefault killed tap-paginate; touch still-hold gate `INSTANT_HOLD_MS=300`
- [Keyboard selection adjust (#4728)](keyboard-selection-adjust-4728.md) — Shift+←/→ char, Ctrl/Alt+Shift word; `onAdjustTextSelection` in useBookShortcuts
- [Annotator onLoad listener leak (#4735)](annotator-onload-listener-leak-paragraph-mode.md) — per-section onLoad leaked listeners; `useRendererInputListeners` once-per-view
- [Paragraph mode toggle/resume (#4717)](paragraph-mode-toggle-resume-4717.md) — dispatch iterates live Set → snapshot; resume from fresh `view.lastLocation.cfi`
- [Paragraph-mode accidental exit (#4474)](paragraph-mode-accidental-exit-4474.md) — backdrop taps exited; `paragraph-show-controls` event; bar `absolute`→`fixed`
- [#4584 tap-death](issue-4584-tap-death-investigation.md) — UNFIXED; `isPopuped` self-heal RED HERRING; likely WebView-148 (emulator 133 can't repro)
- [Dblclick-drag turns page (#4524)](dblclick-drag-pageturn-4524.md) — deferred single-click fires mid-drag; `isMouseDown` gates `postSingleClick`
- [Tap to open image/table (#4600)](tap-to-open-image-table-4600.md) — single-tap opens gallery in reflowable; `iframe-open-media` + `detectMediaTarget`
- [iOS instant-dict double popup](ios-instant-dict-double-popup.md) — multi selectionchange → once-per-gesture latch; `isLongPressHold` 300ms gate
- [Dict popup font size (#4443)](dict-popup-font-size-4443.md) — `fontScale`→`--dict-font-scale`; MDict shadow-DOM needs `::part(dict-content)`
- [Dictionary lemmatization (#4574)](dict-lemmatization-4574.md) — inflected→lemma; `lemmatize/` registry; `-ses→-sis` before `-es`
- [Word Lens inline gloss](wordlens-feature.md) — native hint above hard words; CFI-safe `<ruby cfi-skip>…<rt cfi-inert>`; TTS/search isolation
- [Word Lens en-en](wordlens-en-en.md) — gloss = simplest WordNet synonym; same-lang unblock manifest-driven; rt font/color settings
- [Stripe highest-active plan (#4694)](stripe-plan-highest-active-4694.md) — `plans.plan` = MAX over active subs; `getHighestActivePlan` create+cancel
- [Save image to gallery (#4680)](save-image-to-gallery-android.md) — Save → MediaStore; sharekit 0-byte self-copy bug (Temp==cacheDir)
- [Webtoon Mode (#3647)](webtoon-mode-3647.md) — no-gap scrolled image reading; FXL scroll = fit-width; `scroll-gap`→`--scroll-page-gap`
- [Biometric app-lock (#4645)](biometric-app-lock-4645.md) — read flag from `appLockStore` not settingsStore; plugin `cfg(mobile)`
- [Reference Pages (#4542)](reference-pages-672-4542.md) — 'reference' progressStyle from foliate pageList; per-book `referencePageCount`
- [Share intent + toolbar (#4014)](annotation-share-toolbar-4014.md) — Share tool gated mobile+macOS; drag-drop customizer; `annotationToolbarItems`
- [Native iOS TTS (#4676)](native-ios-tts-4676.md) — AVSpeechSynthesizer plugin; pause==stop, never `end` on didCancel; rate `pow^(1/2.5)`
- [Native TTS offline halt (#4613)](native-tts-offline-autoadvance-4613.md) — `#speak` advances only on `end`; native SKIP-on-error via `forward()` + cap
- [Edge TTS word highlight (#4017)](edge-tts-word-highlighting-4017.md) — `audio.metadata` WordBoundary synced by rAF; gates on UA not Origin
- [Edge TTS word-highlight drift](tts-word-highlight-singletextnode-drift.md) — TEXT_NODE fast path ignored offsets → whole-para; slice `[start,end]`
- [TTS start-from-selection](tts-start-from-selection.md) — `from()` picked first mark after sel (use last at/before); cloneRange+deselect
- [Reuse TTS session on mode entry](tts-reuse-session-mode-entry.md) — `redispatchPosition()` + `tts-sync-request` replay + engage-on-entry
- [RSVP control bar overlap = REVERT](rsvp-control-bar-overlap-revert.md) — #4585 fixed; stale #4589 reverted it incl. guard test
- [RSVP font face/family (#4519)](rsvp-font-settings-4519.md) — was font-mono; `getBaseFontFamily`; overlay renders in top doc
- [RSVP RTL word display (#4630)](rsvp-rtl-word-display-4630.md) — ORP char-split breaks Arabic; `isRTLText` → render whole `dir=rtl`
- [Overlay z-index scale](zindex-overlay-scale.md) — RSVP 100 / Settings 110 / ModalPortal 120 / toast 130 / app-lock 200; invariant test
- [Global annotation page-turn lag (#4575)](global-annotation-pageturn-perf-4575.md) — `global` highlights re-fanned every turn; `WeakMap<Document>` memo
- [Overlayer splitRange text nodes](overlayer-splitrange-textnodes.md) — `'p,h1-h4'` selector dropped `li`; walk text nodes + img/svg
- [Android image callout freeze](android-image-callout-freeze.md) — long-press img callout → freeze; `.no-context-menu` on ANCESTOR
- [Table dark-mode tint (#4419)](table-dark-mode-tint-4419.md) — `blockquote, table *` tint must stay gated on `overrideColor`; paints TOC spacer
- [Footnote aside border line (#4438)](footnote-aside-namespace-order-4438.md) — @font-face before @namespace invalidated it; hoist @namespace
- [Proofread enhancements (#4700)](proofread-enhancements-4700.md) — only global rules sync; regex UI; Ctrl+P reuse; `wholeWord` no-op
- [OPDS Firefox strict-XML (#4479)](opds-firefox-strict-xml-4479.md) — junk after `</feed>` → parsererror; `parseOPDSXML` slices to last close tag
- [OPDS2 JSON search greyed (#4502)](opds2-json-search-4502.md) — `isSearchLink` ignored templated opds+json; expand `{?query}` BEFORE resolveURL
- [OPDS HTML description (#4503)](opds-html-description-4503.md) — double-escaped into unsanitized HTML; decode-once + sanitize
- [D-pad Navigation](dpad-navigation.md) — Android TV remote / arrow-key nav design + pitfalls
- [koplugin cover upload (#4374)](koplugin-cover-upload.md) — local covers uploaded blank; `extractLocalCover` via `getCoverImage`

## Library Fixes
- [Book action platform surfaces](book-actions-platform-surfaces.md) — context menu Tauri-desktop-only; cross-platform actions in `BookDetailView`
- [Tauri menu append race (#4389)](tauri-menu-append-race-4389.md) — un-awaited `Menu.append()` shuffles order; single `await Menu.new({ items })`
- [TXT author recognition (#4390)](txt-author-recognition-4390.md) — 【】 web-novels garbage author; `parseLabeledAuthor` + `isPlausibleAuthorName`
- [TXT chapter measure-word FP (#4658)](txt-chapter-measure-word-4658.md) — strong `[章节回讲篇话]` vs weak `[卷本册部封]` needs separator
- [Cover stale (in-place mutation)](cover-stale-inplace-mutation-memo.md) — mutated book in place → memo skip; pure `getBookWithUpdatedMetadata`
- [Series/author back no-op (#4437)](series-folder-back-noop-4437.md) — Next 16.2 empty-search `router.replace` no-op; `handleBack` `group=''` workaround

## Architecture & Patterns
- foliate-js is a git submodule at `packages/foliate-js/`; multiview paginator preloads adjacent sections (multiple View/Overlayer per book)
- Style: `getLayoutStyles()` always, `getColorStyles()` when overriding color; `transformStylesheet()` regex-rewrites EPUB CSS at load
- TTS independent section tracking (`#ttsSectionIndex`); safe insets: native plugin → useSafeAreaInsets → styles; Dropdowns use `DropdownContext`
- [Foliate touch-listener capture phase](foliate-touch-listener-capture-phase.md) — suppress reader gestures via `{capture:true}`
- [iframe cross-realm instanceof](iframe-cross-realm-instanceof.md) — top realm: `iframeEl instanceof Element` always false; duck-type `'closest' in target`
- [Virtuoso + OverlayScrollbars](virtuoso_overlayscrollbars.md) — useOverlayScrollbars hook for mobile webviews
- [Design system → DESIGN.md](feedback_design_system_doc.md) — codify UI rules; never `pl/pr/ml/mr/text-left/right` (RTL)

## Workflow & Feedback
- [Commit messages English-only](feedback-commit-message-english-only.md) — commit msgs + PR titles English only (no CJK, no em/en dashes). PR #4660
- [Test file filter](feedback_test_file_filter.md) — `pnpm test <path>` without `--` runs a single file
- [Rebase before PR](feedback_pr_rebase.md) — rebase onto origin/main before PRs
- [New branch per PR](feedback_pr_new_branch.md) — fresh branch from main per PR/issue
- [Use worktree](feedback_use_worktree.md) — never `git worktree add`; always `pnpm worktree:new`
- [Never push every change](feedback_dont_push_every_change.md) — commit locally until user confirms or clean done-state
- [No test seams in prod](feedback_no_test_seams_in_prod.md) — prod never imports `__reset*ForTests`
- [No lookbehind regex](feedback_no_lookbehind_regex.md) — never `(?<=)`/`(?<!)`; build check rejects
- [en plurals manual](feedback_en_plurals_manual.md) — only plural variants + proper nouns; plurals need `_one`/`_other`
- [Dependabot transitive fixes](dependabot-pnpm-overrides.md) — pin in `pnpm-workspace.yaml` `overrides:`; alert#≠issue#
- [Upgrade gstack locally](feedback_gstack_upgrade.md) — upgrade from project `.claude/skills/gstack`
