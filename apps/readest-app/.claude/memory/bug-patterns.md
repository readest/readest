# Bug Fixing Patterns & Strategies

## Common Root Cause Categories

### 1. Overly Broad CSS Selectors
**Pattern:** A CSS rule targets too many elements, causing unintended visual side effects.
**Examples:**
- `hr { mix-blend-mode: multiply }` applied to ALL hr elements instead of only decorative ones (#3086)
- `p img { mix-blend-mode }` applied to block images, not just inline (#3112)
- `svg, img { height: auto; width: auto }` overrode explicit HTML width/height attributes (#3274)
- Background-color override applied unconditionally instead of only when user enabled color override (#3316)

**Fix Strategy:** Narrow selectors with class qualifiers (`.background-img`, `.has-text-siblings`) or attribute pseudo-selectors (`:where(:not([width]))`). Check if the rule should be conditional on a user setting.

### 2. Conditional vs Unconditional Style Overrides
**Pattern:** CSS rules meant for "Override Book Color/Layout" mode are placed in the always-active stylesheet.
**Examples:**
- Calibre `.calibre { color: unset }` was in `getLayoutStyles()` instead of `getColorStyles()` (#3448)
- Image background-color override applied without checking `overrideColor` flag (#3316, #3377)

**Fix Strategy:** Move rules to the correct conditional block: `getColorStyles()` for color overrides, `getLayoutStyles()` for layout overrides. Check the `overrideColor`/`overrideLayout` flags.

### 3. Missing EPUB Stylesheet Transformations
**Pattern:** EPUB stylesheets contain CSS that conflicts with app functionality.
**Examples:**
- `user-select: none` prevents text selection (#3370) -> regex replace in `transformStylesheet()`
- `font-family: serif/sans-serif` on body bypasses user font (#3334) -> detect and unset
- Hardcoded Calibre backgrounds persist in dark mode (#3448) -> unset in color override

**Fix Strategy:** Add regex-based transformation passes in `transformStylesheet()` in `style.ts`.

### 4. Stale State / Refs Not Reset
**Pattern:** A `useRef` or state variable is set once and never properly reset, blocking re-entry.
**Examples:**
- TTS `ttsOnRef` prevented restarting TTS from a new location (#3292)
- `initializedRef` in AnnotationRangeEditor prevented handle position updates (#3286)
- `view.tts` not nulled on shutdown prevented clean TTS restart (#3400)
- TTS safety timeout fired after pause, advancing to next sentence (#3244)

**Fix Strategy:** Check all refs/guards in the affected flow. Ensure cleanup in shutdown/unmount. Remove overly aggressive guards that prevent re-entry.

### 5. Platform API Differences
**Pattern:** A Web API behaves differently or is unavailable on certain platforms.
**Examples:**
- `navigator.getGamepads()` returns null on older Android WebView (#3245)
- `CompressionStream` unavailable on some Android versions (#3255)
- `btoa()` throws on non-ASCII characters (#3436)
- View Transitions API unsupported in WebKitGTK/Linux (#3417)
- `document.startViewTransition()` crashes on Linux

**Fix Strategy:** Always check API availability before use. Add fallback paths. Use feature detection, not platform detection when possible.

### 6. Safe Area Inset Issues
**Pattern:** UI elements overlap system bars (status bar, navigation bar, notch) on mobile.
**Examples:**
- Zoom controls behind status bar (#3426)
- Android navigation bar overlap (#3466)
- iPad sidebar insets incorrect (#3395)
- Reader page layout jump after system UI change (#3469)

**Fix Strategy:** Use `gridInsets` and `statusBarHeight` from `useSafeAreaInsets`. Use `env(safe-area-inset-*)` CSS functions. Call `onUpdateInsets()` after system UI visibility changes. See `docs/safe-area-insets.md`.

### 7. Z-Index Layering Issues
**Pattern:** Interactive elements rendered behind other layers, becoming unclickable.
**Examples:**
- Navigation buttons invisible on mobile (#3201) -> added `z-10`
- Annotation nav bar too prominent (#3386) -> reduced from `z-30` to `z-10`
- Page nav buttons behind TTS control (#3184)

**Fix Strategy:** Check z-index ordering. Use minimum necessary z-index. Reference the z-index hierarchy in the codebase.

### 8. Event Handling Race Conditions
**Pattern:** Timing issues between pointer events, native menus, and React state updates.
**Examples:**
- macOS context menu steals pointer event loop (#3324) -> 100ms setTimeout delay
- Traffic light buttons flicker due to timeout race (#3488, #3129)
- Android tool buttons unresponsive due to premature re-selection (#3225)

**Fix Strategy:** Add small delays before native menu calls. Check event state machine consistency. Remove premature re-triggers on Android.

### 9. foliate-js Rendering Issues
**Pattern:** Bugs in the lower-level EPUB renderer (paginator.js, epub.js).
**Examples:**
- Image size not constrained in double-page mode (#3432)
- Background not shown in scrolled mode (#3344)
- Section content cached incorrectly after mode switch (#3242, #3206)
- Swipe sensitivity too low for non-animated paging (#3310)

**Fix Strategy:** Check both `columnize()` and `scrolled()` code paths in paginator.js. Verify CSS variables (`--available-width`, `--available-height`) are computed correctly. Test in both paginated and scrolled modes.

### 10. Progress/Navigation Calculation Errors
**Pattern:** Page counts, progress percentages, or position tracking are wrong.
**Examples:**
- Progress shows 99.9% at last page (#3383) -> boundary condition
- Pages left shows estimated instead of physical count (#3213, #3200)
- FB2 subsection progress wrong (#3136) -> nested structure not handled
- TOC auto-scrolls on expand (#3124) -> scroll-into-view triggered too broadly

**Fix Strategy:** Use physical `view.renderer.page`/`view.renderer.pages` instead of estimated section metadata. Check boundary conditions (0-indexed vs 1-indexed, inclusive vs exclusive).

### 11. Multiview Paginator Side Effects
**Pattern:** The multiview paginator (e925e9d+) loads adjacent sections in background. Events from these loads can interfere with user interactions on the primary section.
**Examples:**
- `load` event from adjacent section triggers `docLoadHandler` which re-adds ALL annotations, overwriting drag edits
- Multiple overlayers with duplicate SVG `<clipPath>` IDs cause `url(#id)` to resolve to wrong element
- `MagnifierLoupe` destroying/recreating body clone on every drag tick triggers ResizeObserver → expand → redraw

**Fix Strategy:** Scope event handlers to the loaded section's index. Use unique IDs for SVG elements across overlayer instances. Minimize iframe DOM mutations during drag operations.

## Debugging Workflow

1. **Identify the category** from the issue description
2. **Check `style.ts`** first for any CSS-related visual bugs
3. **Check foliate-js** for rendering/layout bugs
4. **Check platform-specific code** for mobile/desktop differences
5. **Write a failing test** before implementing the fix
6. **Test in both paginated and scrolled modes** for layout changes
7. **Test on multiple platforms** for any UI change
8. **Run `pnpm build-check`** before submitting
