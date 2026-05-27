# Readest Project Memory

## Key Reference Documents
- [Bug Fixing Patterns](bug-patterns.md) - Common bug categories, root causes, and fix strategies
- [CSS & Style Fixes](css-style-fixes.md) - EPUB CSS override patterns and the style.ts pipeline
- [TTS Fixes](tts-fixes.md) - Text-to-Speech architecture and bug patterns
- [Layout & UI Fixes](layout-ui-fixes.md) - Safe insets, z-index, platform-specific UI issues
- [Platform Compat Fixes](platform-compat-fixes.md) - Android, iOS, Linux, macOS platform-specific bugs
- [Annotator & Reader Fixes](annotator-reader-fixes.md) - Highlight, selection, accessibility bugs

## Critical Files (Most Bug-Prone)
- `src/utils/style.ts` - Central EPUB CSS transformation hub (14+ bug fixes)
- `packages/foliate-js/paginator.js` - Page layout, image sizing, backgrounds
- `src/services/tts/TTSController.ts` - TTS state machine, section tracking
- `src/hooks/useSafeAreaInsets.ts` - Safe area inset management
- `src/app/reader/components/FoliateViewer.tsx` - Reader view orchestration
- `src/app/reader/components/annotator/Annotator.tsx` - Annotation lifecycle

## Feature Notes
- [D-pad Navigation](dpad-navigation.md) — Android TV remote / keyboard arrow navigation design, key files, and pitfalls
- [Cloudflare Workers WebSocket](cloudflare-workers-websocket.md) — use fetch() Upgrade pattern (not `ws` npm); CF delivers binary frames as Blob (must serialize async decodes)
- [Share-a-Book Feature (in progress)](share-feature.md) — locked decisions for the /s/{token} share-link feature; plan at ~/.claude/plans/ok-we-will-learn-cosmic-acorn.md
- [readest.koplugin i18n](koplugin-i18n.md) — gettext loader at `apps/readest.koplugin/i18n.lua`, `.po` catalog at `locales/<i18next-code>/translation.po`, extract/apply scripts in `scripts/`

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
