# Annotator & Reader Fixes Reference

## Annotation System Architecture

### Key Components
- `Annotator.tsx` - Annotation lifecycle, popup display, style/color management
- `AnnotationRangeEditor.tsx` - Drag handles for adjusting selection range
- `MagnifierLoupe.tsx` - Magnifying glass during handle drag (mobile only)
- `useTextSelector.ts` - Text selection detection and processing
- `useAnnotationEditor.ts` - Editing existing annotations
- `useInstantAnnotation.ts` - Creating new annotations on selection

### Highlight Rendering
- Highlights rendered by foliate-js `Overlayer` (SVG overlayer in paginator shadow DOM, not iframe)
- Each view in multiview paginator has its own `Overlayer` instance with unique clipPath ID
- `Overlayer.add()` stores range + draw function; `redraw()` recalculates positions from stored ranges
- Colors stored as color names mapped to custom hex via `globalReadSettings.customHighlightColors`
- Sidebar uses `color-mix()` CSS function with custom colors, not Tailwind utility classes (#3273)
- Rounded highlight style supported via `vertical` option passed to overlayer (#3208)

### Multiview Overlayer Pitfalls
- **Duplicate SVG IDs**: Each overlayer creates `<clipPath>` for loupe hole — IDs MUST be unique per instance or `url(#id)` resolves to wrong element, clipping everything
- **docLoadHandler scope**: `FoliateViewer.tsx` re-adds annotations on `load` event — MUST filter by `detail.index` (loaded section), not re-add ALL annotations (overwrites drag edits)
- **MagnifierLoupe lifecycle**: Don't destroy/recreate loupe on every drag tick — `hideLoupe()` should only run on unmount, `showLoupe()` fast path updates position only
- **Stale closures in useTextSelector**: `getProgress()` must be called inside callbacks, not captured at hook top-level (useFoliateEvents deps are `[view]` only)

## Fix History

| Issue | Problem | Root Cause | Fix |
|-------|---------|------------|-----|
| #3286 | Selection stuck on first annotation | `initializedRef` guard blocked re-computation | Remove guard, consolidate style/color effects |
| #3273 | Custom colors not in sidebar | Hardcoded Tailwind classes | Use inline `style` with `color-mix()` |
| #3234 | Letter-by-letter selection on mobile | No word boundary snapping | Add `snapRangeToWords()` using `Intl.Segmenter` |
| #3208 | Hard rectangular highlights | No border radius support | Pass `vertical` option, update foliate-js |
| #3002 | Can't see text under finger | No magnification UI | New `MagnifierLoupe` component using `view.renderer.showLoupe()` |
| #3082 | No page numbers on annotations | `pageNumber` field missing | Add `pageNumber` to BookNote type, compute on create |
| #3225 | Android tools unresponsive | Premature `makeSelection()` call | Remove premature re-selection in Android path |

## Common Annotation Bugs

### Selection Issues
- **Word snapping**: Uses `Intl.Segmenter` with `granularity: 'word'` to snap selection to word boundaries
- **Android re-selection**: Don't call `makeSelection(sel, index, true)` immediately on pointer-up; let the popup flow complete
- **Range editor handles**: Remove `initializedRef` guards that prevent re-computation when switching annotations

### Color/Style Issues
- **Custom colors in sidebar**: Use inline `style={{ backgroundColor: 'color-mix(...)' }}` not Tailwind classes
- **Style synchronization**: Consolidate `selectedStyle` and `selectedColor` into one `useEffect`
- **Switching annotations**: Must call `setShowAnnotPopup(false)` and `setEditingAnnotation(null)` before setting up new annotation

## Reader/Content Fixes

### Progress Display
- Use physical `view.renderer.page` and `view.renderer.pages` for page counts (#3213, #3200)
- Last page shows 100% by fixing boundary condition (#3383)
- FB2 subsections need special handling for progress (#3136)

### Translation View (#3078)
- Problem: Page jumps back during full-text translation
- Root cause: DOM mutations from sequential translation insertions cause paginator relayout
- Fix: Batch DOM updates with 50ms timer, use bounded concurrent queue (max 5), show loading overlay

### TOC Navigation (#3124)
- Problem: Expanding TOC chapter scrolls back to current chapter
- Fix: Only scroll-into-view on navigation, not on expand/collapse

## Accessibility (a11y) Fixes

### Screen Reader (TalkBack) Support
- **Page indicator updates** (#2276): Add focus handlers on `<p>` elements that call `view.goTo(cfi)` to update position
- **Navigation buttons** (#3036): Always show prev/next buttons when screen reader active; `PageNavigationButtons.tsx`
- **Dropdown menus** (#3035): Use `DropdownContext` with overlay dismiss instead of blur-based closing

### Dropdown Architecture for a11y
- `DropdownContext` (`src/context/DropdownContext.tsx`) manages which dropdown is open globally
- Uses `useId()` for unique identification
- One dropdown open at a time
- `<Overlay>` for dismissal (tap/click outside) instead of `onBlur`
- `<details>` element with `open={isOpen}` for semantic structure
- No auto-focus-first-item (conflicts with TalkBack)

## E-ink Readability
- Use `not-eink:` Tailwind variant for colors and opacity (#3258)
- Don't use `text-primary` (blue) or low opacity on e-ink
- Highlights use foreground color in dark mode e-ink (#3299)

## Key Utility Functions
- `snapRangeToWords()` in `src/utils/sel.ts` - Word boundary snapping
- `handleAccessibilityEvents()` in `src/utils/a11y.ts` - Screen reader focus handling
- `color-mix()` CSS function for custom highlight colors with opacity
