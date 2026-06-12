# Readest Project Memory

## Key Reference Documents
- [Bug Fixing Patterns](bug-patterns.md) - Common bug categories, root causes, and fix strategies
- [CSS & Style Fixes](css-style-fixes.md) - EPUB CSS override patterns and the style.ts pipeline
- [TTS Fixes](tts-fixes.md) - Text-to-Speech architecture and bug patterns
- [Layout & UI Fixes](layout-ui-fixes.md) - Safe insets, z-index, platform-specific UI issues
- [Platform Compat Fixes](platform-compat-fixes.md) - Android, iOS, Linux, macOS platform-specific bugs
- [Annotator & Reader Fixes](annotator-reader-fixes.md) - Highlight, selection, accessibility bugs

## Paginator Scroll Knowledge
- [Issue #4112 scroll-anchoring](issue-4112-scroll-anchoring.md) — RESOLVED (PR #4349). Scroll-anchoring suppressed at scrollTop 0 when prepending a section in scrolled mode; fix patterns (prepend compensation, eager backward preload, no-blank nav) + test & dev-server gotchas
- [Reading ruler line/column-aware](reading-ruler-line-aware.md) — ruler snaps to real lines; multi-column band spans one column; Range.getClientRects() returns tall block boxes that must be dropped; iframe frame-offset mapping; synthetic-key throttling
- [TOC expand + auto-scroll](toc-expand-and-autoscroll.md) — #4059 collapse-by-default policy in `tocTree.ts`; pinned-sidebar mounts before progress → dynamic expansion breaks scroll-to-current via (1) spurious onScroll clearing pending and (2) Virtuoso scrollToIndex landing short after row growth (re-assert on rAF)
- [BooknoteView auto-scroll (#4352)](booknote-view-autoscroll-4352.md) — virtualizing the annotation/bookmark list dropped auto-scroll-to-nearest; two paths (reload: OverlayScrollbars resets scrollTop → re-apply in `initialized` via ref; tab-switch: synchronous scrollToIndex on fresh-mounted list wedges Virtuoso → use `initialTopMostItemIndex` + skip-gate). Mirrors TOCView. Includes dev-server/Fast-Refresh/screenshot-vs-DOM verification gotchas
- [TOC current-position row](toc-current-position-row.md) — synthetic "Current position" row (open-book icon + live `progress.page`) injected one level deeper under the active TOC item via `buildTOCDisplayItems` in `TOCItem.tsx`. INVARIANT: insert AFTER the active item so its `flatItems` index stays valid for the auto-scroll effects
- [Swipe page-turn bg flash](paginator-swipe-bg-flash.md) — white↔black flash on swipe+animation only; `#background` was static screen-space and didn't track content during drag/snap; fix = sliding per-view full-bleed segments (`computeBackgroundSegments`) rebuilt on scroll + per-rAF synced to the view transform during snap
- [Duokan fullscreen cover hidden in scroll mode](duokan-fullscreen-cover-scroll.md) — #4379 `data-duokan-page-fullscreen` cover pinned `position:absolute height:100%` collapses against auto-height scroll container; gate fullscreen on `this.#column` + reset stale absolute props on toggle (`setImageSize` in paginator.js)
- [Paginated texture occlusion](paginated-texture-occlusion-4399.md) — #4399 host `.foliate-viewer::before` texture absent in paginated (shown in scrolled); opaque `#background` container (`= fallbackBg`) from the swipe-flash fix occludes it; shared `textureAwareBackground` helper + `hasTexture ? '' : fallbackBg` container
- [Background overflows column (#4394, PR #4429)](paginator-gutter-bleed-asymmetry-4394.md) — paginated page bg stretched into the outer `--_outer-min` gutter → mixed cover/title 2-up spread shifted off-centre (~250px at 1920px). KEEP the grid (`--_outer-min` keeps margins symmetric); fix = clamp `computeBackgroundSegments` to `[containerStart,containerEnd]` (Math.max/Math.min) so bg stays in its column. 2 wrong tries first (bleed-gating, "page shouldn't be yellow"); foliate submodule needs dev-server RESTART to pick up edits

## Critical Files (Most Bug-Prone)
- `src/utils/style.ts` - Central EPUB CSS transformation hub (14+ bug fixes)
- `packages/foliate-js/paginator.js` - Page layout, image sizing, backgrounds
- `src/services/tts/TTSController.ts` - TTS state machine, section tracking
- `src/hooks/useSafeAreaInsets.ts` - Safe area inset management
- `src/app/reader/components/FoliateViewer.tsx` - Reader view orchestration
- `src/app/reader/components/annotator/Annotator.tsx` - Annotation lifecycle

## Sync Notes
- [KOSync CFI spine resolution](kosync-cfi-spine-resolution.md) — convert via the CFI's own spine (`getXPointerFromCFI`/`getCFIFromXPointer`), never `new XCFI(primaryDoc, primaryIndex)`; primaryIndex lags during scroll → spine-mismatch throw
- [Empty-start CFI sync bug](empty-start-cfi-sync.md) — `epubcfi(/6/24!/4,,/20/1:58)` (empty-start range) from the cfi-inert skip-link transitional window; jumps to wrong section end; `isMalformedLocationCfi` → discard the synced value in `useProgressSync` (NOT the local open path); foliate fix doesn't repair already-synced values
- [Custom fonts disappear on cloud sync (#4410)](custom-fonts-reincarnation-4410.md) — CRDT remove-wins: re-import-after-delete needs a `reincarnation` token or the pull re-applies the tombstone; `addFont`/`addTexture` minted none; fix mirrors dictionary (both cases) + OPDS token style; coverage matrix per kind

## Testing
- [Android CDP e2e lane](android-cdp-e2e-lane.md) — `pnpm test:android`: adb+CDP drives the installed app on device/emulator; discover-don't-assume targeting, injected hyphenation, MediaStore VIEW transient open (canonical `_data` path gotcha), per-section frame restore; CI workflow with KVM emulator + debug x86_64 APK (no signing secrets)
- [CDP Android WebView profiling](cdp-android-webview-profiling.md) — drive the on-device Readest WebView via adb+CDP to run JS probes/benchmarks inside the live app (no rebuild); gotchas: locked device freezes fetch (not invoke), visible:false throttles setTimeout, `__TAURI_INTERNALS__.convertFileSrc/invoke` always present, books in internal `/data/user/0/...`, fs `read{rid,len}` last-8-bytes=nread, `fs|close` not ACL-allowed, curl mishandles WebView HTTP framing
- [Tauri Rust↔JS parser parity tests](tauri-parser-parity-tests.md) — #4369 native Rust EPUB/MOBI parser; how to cross-check vs foliate-js in the `.tauri.test.ts` WebView suite (CWD disk path for Rust, Vite URL for JS, normalizer-based compare, cover presence-only, desc whitespace-collapse); the `dcterms:modified`→`published` divergence fix

## Build & Vendoring
- [pdfjs vendor wasm decoders](pdfjs-vendor-wasm-decoders.md) — scanned PDFs blank in CI build only (0.11.2 regression); pdfjs 5.7.x moved JBIG2 to `jbig2.wasm`, `copy-pdfjs-wasm` allow-list dropped it; `cpx` no-errors on empty glob; local stale `public/vendor` (gitignored, not refreshed by `tauri build`) masked it; fix = copy `wasm/*`

## Platform Compat
- [Android hyphen selection bounds (#1553)](android-hyphen-selection-bounds-1553.md) — Blink paints the start handle on the paragraph's LAST hyphen when a touch selection starts at the first word of a hyphenated paragraph (`ComputePaintingSelectionStateForCursor` lacks the generated-text offset remap, hyphen offsets {0,1}); drag-extend re-anchors base there. Fix = repair jumped anchor + suppress handles (empty-commit needs one painted frame) + `SelectionRangeEditor` custom handles; multicol NOT required; desktop/iOS unaffected
- [Android NativeFile vs RemoteFile I/O](android-nativefile-remotefile-io.md) — why NativeFile is slow (4-IPC/chunk + bridge serialization, tauri#9190); RemoteFile CANNOT replace it on Android (asset-protocol Range broken: start>0 → "Failed to fetch", start-0 capped at 1,024,000; plain no-Range fetch returns full file at 281 MB/s); measured 44/100/281 MB/s; speedups = handle-reuse (2.3×), whole-file asset loader (6.3×), or fix wry upstream. Verified live via CDP.
- [Window-state sanitizer (#4398)](window-state-sanitize-4398.md) — Windows launch crash (WebView2 0x80070057) from invalid `.window-state.json` (`-32000` minimized sentinel / `0×0`); our plugin already has upstream #253 fix so bad files are stale; defense-in-depth `window-state-sanitizer` plugin registered BEFORE window-state (plugin init = registration order); coord threshold `-16000` (~halfway to the -32000 sentinel; real desktops sit a few thousand px off origin) keeps multi-monitor negatives
- [Android Open-with intent flow (#4521)](android-open-with-intent-flow.md) — "Open with"/"Send to" pipeline: `NativeBridgePlugin.kt::handleIntent` → `shared-intent` → `useAppUrlIngress` → `useOpenWithBooks` (VIEW=transient→reader, SEND=library+upload). Telegram fails where file-manager works on TWO axes: cold-start delivery (fixed by #4527, on dev NOT released v0.11.4) + foreign-private-file read (Telegram FileProvider non-persistable grant vs shared-storage FUSE real-path). adb MediaStore VIEW repro tests pipeline but CANNOT reproduce the read axis (MANAGE_EXTERNAL_STORAGE bypasses grant)

## Feature Notes
- [Reference Pages (#672+#4542, PR #4549)](reference-pages-672-4542.md) — 'reference' progressStyle from foliate `pageItem`/`book.pageList` (numeric-max total rule, roman-tail safe); per-book `referencePageCount` via skipGlobal save; verification EPUBs + dev-web synthetic drag-drop import trick; locale-tail rebase-conflict recipe (checkout --ours → re-extract → re-translate)
- [OPDS Firefox strict-XML parse (#4479)](opds-firefox-strict-xml-4479.md) — MEK feed has junk after `</feed>`; Firefox DOMParser → `<parsererror>` (silent back-nav), Chrome lenient; `parseOPDSXML` slices root start→last close tag; jsdom mirrors Firefox; wired into page.tsx + validateOPDSURL + feedChecker (latter also #4181 `looksLikeXMLContent` swap)
- [OPDS 2.0 JSON search greyed out (#4502)](opds2-json-search-4502.md) — `isSearchLink` ignored templated `application/opds+json` links → `hasSearch` false → disabled navbar input; add `MIME.OPDS2`+`templated`, `expandOPDSSearchTemplate` (foliate `uri-template.js`), handleSearch OPDS2 branch. Gotcha: `resolveURL` mangles `{?query}` braces — expand template BEFORE resolving
- [OPDS HTML description (#4503)](opds-html-description-4503.md) — detail-view descriptions showed raw `<p>`/`&quot;` tags; aggregator double-escapes `type="text"` summary + `PublicationView` dumped it into unsanitized `dangerouslySetInnerHTML`; fix = `getOPDSDescriptionHtml` (decode-one-level-iff-fully-escaped, then `sanitizeHtml`)
- [Manage Cache + iOS container layout](manage-cache-ios-layout.md) — `'Cache'` base = `Library/Caches/<bundle>` only (not all of Caches); iOS `Documents/Inbox` cleared too; WebKit cache + tmp out of reach; never touch App Support
- [D-pad Navigation](dpad-navigation.md) — Android TV remote / keyboard arrow navigation design, key files, and pitfalls
- [Cloudflare Workers WebSocket](cloudflare-workers-websocket.md) — use fetch() Upgrade pattern (not `ws` npm); CF delivers binary frames as Blob (must serialize async decodes)
- [Share-a-Book Feature (in progress)](share-feature.md) — locked decisions for the /s/{token} share-link feature; plan at ~/.claude/plans/ok-we-will-learn-cosmic-acorn.md
- [readest.koplugin i18n](koplugin-i18n.md) — gettext loader at `apps/readest.koplugin/i18n.lua`, `.po` catalog at `locales/<i18next-code>/translation.po`, extract/apply scripts in `scripts/`
- [koplugin cover upload](koplugin-cover-upload.md) — #4374 uploadBook only shipped cached cloud covers; local-origin books uploaded blank. Fix = `extractLocalCover` via `FileManagerBookInfo:getCoverImage(nil, file)` → `writeToFile(path,"png")`. KOReader checkout at `/Users/chrox/dev/koreader`

## Patterns
- [Virtuoso + OverlayScrollbars](virtuoso_overlayscrollbars.md) — useOverlayScrollbars hook integration for overlay scrollbars on mobile webviews
- [Design system → DESIGN.md](feedback_design_system_doc.md) — codify recurring UI/UX rules in `apps/readest-app/DESIGN.md`; never `pl/pr/ml/mr/text-left/text-right` (RTL); §5 boxed list anatomy has uniform `min-h-14` rows and chromeless controls

## Reader UI Fixes
- [Overlayer splitRange by text nodes](overlayer-splitrange-textnodes.md) — highlight SVG missed bullet-list text when range also touched a `<p>`: `#splitRangeByParagraph`'s `'p,h1-h4'` selector dropped `li` (3rd whack-a-mole after f087826/920676b); fix = walk text nodes + `img,svg` in overlayer.js, never block-tag selectors; jsdom test stubs `Range.prototype.getClientRects`
- [Android image callout freeze](android-image-callout-freeze.md) — long-press `<img>` fires WebView native callout that collides with app touch handlers → whole-app freeze; `-webkit-touch-callout: none` doesn't inherit so put `.no-context-menu` on an ancestor of the image (`.no-context-menu img` rule in globals.css); seen on book covers (#4345) + image preview/zoom (#4420, `ImageViewer.tsx`)
- [ProgressBar focus-ring line (#4397)](progressbar-focus-ring-4397.md) — decorative `.progressinfo` footer was `tabIndex={-1}` → Android long-press focused it → stray content-width focus-ring line at the bottom every page; fix = drop tabIndex (role='presentation' must not be focusable); ffmpeg-the-video debugging + live-browser `:focus-visible` confirmation
- [Table dark-mode tint regression (#4419)](table-dark-mode-tint-4419.md) — `blockquote, table *` color-mix tint in `getColorStyles` must stay gated on `overrideColor` (gate added #2377, removed #4055, re-broke → #4419); safe now that #4392 light-bg rewriters handle #4028 zebra legibility; SAME rule paints vertical-TOC `.space`/▉ spacer cells (▉ U+2589 = blank glyph, contours=0) → "spacing changes" symptom; both fixed by the gate
- [Double-click-drag turns page (#4524)](dblclick-drag-pageturn-4524.md) — web double-click+drag selection also turned the page; 1st click's deferred single-click (250ms) fires mid-drag while 2nd-click button held; fix = `isMouseDown` flag in `iframeEventHandlers.ts` gates the deferred `postSingleClick`; synthetic-repro gotchas (shadow-DOM iframe walk, chained-repro timing pollution, reload to re-bind listeners)
- [RSVP font face/family (#4519)](rsvp-font-settings-4519.md) — RSVP word was hardcoded `font-mono`; now mirrors the reader font via `getBaseFontFamily(viewSettings)` (new export in `style.ts`, shares `buildFontFamilyLists` with `getFontStyles`). Overlay renders in the TOP document (portal to body) where custom + basic Google fonts are mounted; known gap = built-in CJK web fonts only in top doc when `isCJKEnv()`
- [Footnote aside border line (#4438)](footnote-aside-namespace-order-4438.md) — v0.11.4 regression: stray horizontal line below footnote marker. #4383 inlined custom `@font-face` BEFORE the `@namespace epub` (which lived in `getPageLayoutStyles`), invalidating it per CSS spec → namespaced `aside[epub|type~="footnote"]{display:none}` dropped → book's `aside{border:3px double}` showed. Only with custom fonts loaded. Fix = hoist `@namespace` to front of `getStyles`. Repro needs XHTML (`epub:type` namespaced only in XML); Playwright `setContent` parses HTML and won't reproduce
- [Paragraph-mode accidental exit + off-center bar (#4474)](paragraph-mode-accidental-exit-4474.md) — backdrop/center taps exited focus mode (stray "too high/low" taps); `ParagraphBar` only reshows on mousemove (no touch reshow) so can't just delete tap-exits → new `paragraph-show-controls` event reveals the bar instead. Also bar `absolute`→`fixed`: it centered on the gridcell which a pinned sidebar shifts right, while the paragraph centers on the `fixed inset-0` overlay/viewport

## Library Fixes
- [Tauri menu append race (#4389)](tauri-menu-append-race-4389.md) — un-awaited `Menu.append()` (async IPC) in `BookshelfItem.tsx` → context-menu items shuffle order every open (native only, invisible in jsdom); fix = single `await Menu.new({ items })` of ordered `MenuItemOptions`; order/inclusion extracted to pure `getBookContextMenuItemIds` for unit testing
- [TXT author recognition (#4390)](txt-author-recognition-4390.md) — 【】-titled Chinese web-novels show author missing/garbage; they're TXT→EPUB (title==full filename is the tell, check `txt.ts` not foliate-js); `extractTxtFilenameMetadata` only handled 《》 + greedy header capture grabbed metadata blobs; fix = `parseLabeledAuthor` for any filename + `isPlausibleAuthorName` guard

## Library Architecture
- [Book action platform surfaces](book-actions-platform-surfaces.md) — library context menu is **Tauri-desktop-only** (`hasContextMenu` false on web + iOS/Android); cross-platform book actions go in `BookDetailView`'s icon row. #4543 Goodreads search added both surfaces + a built-in web-search provider for highlighted-text lookup

## Architecture Notes
- foliate-js is a git submodule at `packages/foliate-js/`
- Multiview paginator: loads adjacent sections in background, multiple View/Overlayer instances per book
- Style overrides: `getLayoutStyles()` (always), `getColorStyles()` (when overriding color)
- `transformStylesheet()` does regex-based EPUB CSS rewriting at load time
- TTS uses independent section tracking (`#ttsSectionIndex`) decoupled from view
- Safe area insets flow: Native plugin -> useSafeAreaInsets hook -> component styles
- Dropdown menus use `DropdownContext` (not blur-based) for screen reader compat
- [Foliate touch-listener capture phase](foliate-touch-listener-capture-phase.md) — to suppress reader gestures from the app, use `{capture:true}`; the paginator registers bubble-phase doc listeners first (during `view.open()`)
- [iframe cross-realm instanceof](iframe-cross-realm-instanceof.md) — app-bundle code (style.ts, iframeEventHandlers.ts) runs in top realm; `iframeEl instanceof Element` is ALWAYS false → guards silently drop all iframe elements (passes jsdom, dead in app). Duck-type `'closest' in target` instead. Bit PR #4391's touch routing + applyTableStyle dedupe

## Workflow
- [Test file filter](feedback_test_file_filter.md) — use `pnpm test <path>` without `--` to run a single file
- [Always rebase before PR](feedback_pr_rebase.md) — rebase onto origin/main before creating PRs
- [New branch per PR](feedback_pr_new_branch.md) — always create a fresh branch from main for each new PR/issue
- [Upgrade gstack locally](feedback_gstack_upgrade.md) — always upgrade from the project's .claude/skills/gstack, not global
- [No lookbehind regex](feedback_no_lookbehind_regex.md) — never use `(?<=)` or `(?<!)` in JS/TS; build check rejects them
- [Use worktree](feedback_use_worktree.md) — never `git worktree add` directly; always `pnpm worktree:new` before PR review, issue fix, or feature work
- [en/translation.json holds ONLY plural variants + proper nouns](feedback_en_plurals_manual.md) — non-plural strings stay out (defaultValue: key is the en source); plural strings (`_('...', { count })`) need hand-added `_one`/`_other` entries or the singular renders as "1 days"
- [Never push on every change](feedback_dont_push_every_change.md) — hold pushes during active bug iteration; commit locally only until user confirms or work hits a clean done-state
- [No test seams in production code](feedback_no_test_seams_in_prod.md) — production must never import or call `__reset*ForTests`; cross-module test resets belong in the test file's beforeEach/afterEach
- [Dependabot transitive fixes](dependabot-pnpm-overrides.md) — pin patched min-version in `pnpm-workspace.yaml` `overrides:` (NOT package.json `pnpm.overrides`, which pnpm 9+ ignores); watch for existing too-low pins; alert#≠issue# so no `Closes #` (PR #4523)
- [CI/PR delivery + push keepalive](ci-pr-delivery-and-push.md) — package small PRs from a dirty dev tree via temp-index plumbing (no worktree); slow pre-push hook (~55s full suite) + SOCKS-proxy SSH → idle "Broken pipe", fixed with `ServerAliveInterval`; `--no-verify` safe once the hook already passed (always `git ls-remote` to confirm a push landed)
