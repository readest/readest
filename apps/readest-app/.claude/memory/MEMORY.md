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
- [Swipe page-turn bg flash](paginator-swipe-bg-flash.md) — white↔black flash on swipe+animation only; `#background` was static screen-space and didn't track content during drag/snap; fix = sliding per-view full-bleed segments (`computeBackgroundSegments`) rebuilt on scroll + per-rAF synced to the view transform during snap
- [Duokan fullscreen cover hidden in scroll mode](duokan-fullscreen-cover-scroll.md) — #4379 `data-duokan-page-fullscreen` cover pinned `position:absolute height:100%` collapses against auto-height scroll container; gate fullscreen on `this.#column` + reset stale absolute props on toggle (`setImageSize` in paginator.js)
- [Paginated texture occlusion](paginated-texture-occlusion-4399.md) — #4399 host `.foliate-viewer::before` texture absent in paginated (shown in scrolled); opaque `#background` container (`= fallbackBg`) from the swipe-flash fix occludes it; shared `textureAwareBackground` helper + `hasTexture ? '' : fallbackBg` container

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
- [Tauri Rust↔JS parser parity tests](tauri-parser-parity-tests.md) — #4369 native Rust EPUB/MOBI parser; how to cross-check vs foliate-js in the `.tauri.test.ts` WebView suite (CWD disk path for Rust, Vite URL for JS, normalizer-based compare, cover presence-only, desc whitespace-collapse); the `dcterms:modified`→`published` divergence fix

## Build & Vendoring
- [pdfjs vendor wasm decoders](pdfjs-vendor-wasm-decoders.md) — scanned PDFs blank in CI build only (0.11.2 regression); pdfjs 5.7.x moved JBIG2 to `jbig2.wasm`, `copy-pdfjs-wasm` allow-list dropped it; `cpx` no-errors on empty glob; local stale `public/vendor` (gitignored, not refreshed by `tauri build`) masked it; fix = copy `wasm/*`

## Platform Compat
- [Window-state sanitizer (#4398)](window-state-sanitize-4398.md) — Windows launch crash (WebView2 0x80070057) from invalid `.window-state.json` (`-32000` minimized sentinel / `0×0`); our plugin already has upstream #253 fix so bad files are stale; defense-in-depth `window-state-sanitizer` plugin registered BEFORE window-state (plugin init = registration order); coord threshold `-16000` (~halfway to the -32000 sentinel; real desktops sit a few thousand px off origin) keeps multi-monitor negatives

## Feature Notes
- [Manage Cache + iOS container layout](manage-cache-ios-layout.md) — `'Cache'` base = `Library/Caches/<bundle>` only (not all of Caches); iOS `Documents/Inbox` cleared too; WebKit cache + tmp out of reach; never touch App Support
- [D-pad Navigation](dpad-navigation.md) — Android TV remote / keyboard arrow navigation design, key files, and pitfalls
- [Cloudflare Workers WebSocket](cloudflare-workers-websocket.md) — use fetch() Upgrade pattern (not `ws` npm); CF delivers binary frames as Blob (must serialize async decodes)
- [Share-a-Book Feature (in progress)](share-feature.md) — locked decisions for the /s/{token} share-link feature; plan at ~/.claude/plans/ok-we-will-learn-cosmic-acorn.md
- [readest.koplugin i18n](koplugin-i18n.md) — gettext loader at `apps/readest.koplugin/i18n.lua`, `.po` catalog at `locales/<i18next-code>/translation.po`, extract/apply scripts in `scripts/`
- [koplugin cover upload](koplugin-cover-upload.md) — #4374 uploadBook only shipped cached cloud covers; local-origin books uploaded blank. Fix = `extractLocalCover` via `FileManagerBookInfo:getCoverImage(nil, file)` → `writeToFile(path,"png")`. KOReader checkout at `/Users/chrox/dev/koreader`

## Patterns
- [Virtuoso + OverlayScrollbars](virtuoso_overlayscrollbars.md) — useOverlayScrollbars hook integration for overlay scrollbars on mobile webviews
- [Design system → DESIGN.md](feedback_design_system_doc.md) — codify recurring UI/UX rules in `apps/readest-app/DESIGN.md`; never `pl/pr/ml/mr/text-left/text-right` (RTL); §5 boxed list anatomy has uniform `min-h-14` rows and chromeless controls

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
