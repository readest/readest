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

## Architecture Notes
- foliate-js is a git submodule at `packages/foliate-js/`
- Multiview paginator: loads adjacent sections in background, multiple View/Overlayer instances per book
- Style overrides: `getLayoutStyles()` (always), `getColorStyles()` (when overriding color)
- `transformStylesheet()` does regex-based EPUB CSS rewriting at load time
- TTS uses independent section tracking (`#ttsSectionIndex`) decoupled from view
- Safe area insets flow: Native plugin -> useSafeAreaInsets hook -> component styles
- Dropdown menus use `DropdownContext` (not blur-based) for screen reader compat
