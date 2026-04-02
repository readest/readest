# CSS & Style Fixes Reference

## The `style.ts` Pipeline (`src/utils/style.ts`)

This is the most bug-prone file in the codebase (14+ fixes). It handles all EPUB CSS transformations.

### Key Functions

#### `getLayoutStyles()`
- Always-active styles applied to every EPUB section
- Controls: line-height, hyphens, image sizing, table display
- Rules here should NOT be conditional on user settings
- Common mistake: putting color-related rules here instead of `getColorStyles()`

#### `getColorStyles()`
- Conditionally applied when user enables "Override Book Color"
- Controls: foreground/background colors, mix-blend modes, image backgrounds
- Gate rules on `overrideColor` flag

#### `transformStylesheet()`
- Regex-based rewriting of EPUB CSS at load time
- Runs on every stylesheet loaded from the EPUB
- Used to neutralize problematic EPUB CSS declarations

#### `applyTableStyle()`
- Post-render function that scales tables to fit available width
- Uses `getComputedStyle()` (not inline `style.width`) to read actual width
- Has two scaling paths: column-width-based and parent-container-based

### Fix History by Issue

| Issue | Problem | Fix in style.ts |
|-------|---------|-----------------|
| #3494 | Line spacing not on `<li>` | Added `li` CSS rule for `line-height` and `hyphens` |
| #3448 | Calibre colors persist | Moved `.calibre` unset to `getColorStyles()`, added `background-color: unset` |
| #3441 | Body padding/margin | Added `padding: unset; margin: unset` to body in `getLayoutStyles()` |
| #3316 | Image bg unconditional | Made `background-color` rule conditional on `overrideColor` |
| #3377 | Image bg override | Same pattern as #3316, only override when `overrideColor` is true |
| #3334 | Generic font-family | `transformStylesheet()` replaces `font-family: serif/sans-serif` with `unset` on body |
| #3370 | user-select: none | `transformStylesheet()` replaces all `user-select: none` with `unset` |
| #3284 | Table scaling | Added fallback when `totalTableWidth` is 0 but parent has width |
| #3351 | Table display broken | Added `display: table !important` to table rule |
| #3274 | Image dimensions | Changed selectors to `:where(:not([width]))` and `:where(:not([height]))` |
| #3205 | Table width reading | Changed from `style.width` to `getComputedStyle().width`, fixed CSS var unit |
| #3112 | Mix-blend on all images | Narrowed selector to `.has-text-siblings` class |
| #3086 | Mix-blend on hr | Narrowed selector to `hr.background-img` |
| #3012 | Vertical alignment | Fixed available dimensions (subtract insets), replaced `100vw/vh` with CSS vars |

### Common Patterns

1. **Adding new element rules:** Copy the pattern from `p` rules (e.g., adding `li` for #3494)
2. **EPUB CSS neutralization:** Add regex in `transformStylesheet()` to replace problematic declarations
3. **Conditional overrides:** Use `overrideColor`/`overrideLayout` flags to gate rules
4. **Selector narrowing:** Use class qualifiers or attribute pseudo-selectors to avoid over-matching
5. **Table fixes:** Always use `getComputedStyle()`, not inline style. Check both width paths.

### CSS Variables from foliate-js

- `--available-width` - Usable content width (set by paginator.js)
- `--available-height` - Usable content height
- `--full-width` - Full viewport width (numeric, multiply by 1px)
- `--full-height` - Full viewport height (numeric, multiply by 1px)
- `--overlayer-highlight-opacity` - Highlight transparency (default 0.3)

### foliate-js Rendering (`packages/foliate-js/paginator.js`)

Key functions:
- `columnize()` - Paginated layout path
- `scrolled()` - Scrolled layout path
- `setImageSize()` - Constrains image dimensions to available space
- `#replaceBackground()` - Transfers EPUB backgrounds to paginator layer
- `snap()` - Swipe gesture detection for page turning

Common issue: A fix applied to `columnize()` but not `scrolled()` (or vice versa). Always check both paths.
