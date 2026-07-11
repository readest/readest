---
name: pdf-cbz-contrast-view-menu
description: "Contrast option in View menu for fixed-layout (PDF/CBZ) docs; per-book, CSS filter"
metadata: 
  node_type: memory
  type: project
  originSessionId: 94f785c8-9015-4140-b64d-c6177e033189
---

Added a **Contrast** stepper to the reader **View menu** (`ViewMenu.tsx`) for fixed-layout / image docs (PDF/CBZ/FXL-EPUB). Models the existing `invertImgColorInDark` / `zoomLevel` pattern. Increase/decrease/reset (+ / – / ◐%), gated inside the `rendition?.layout === 'pre-paginated'` block, placed right under the Zoom Level control.

**Key wiring (mirror this for any future fixed-layout image adjustment — brightness, saturation):**
- Type: `contrast: number` in `BookStyle` (`types/book.ts`, fixed-layout section). Default `contrast: 100` in `DEFAULT_BOOK_STYLE` (`constants.ts`); also `MIN_CONTRAST=50`/`MAX_CONTRAST=300`/`CONTRAST_STEP=10`.
- Filter applied in `applyFixedlayoutStyles()` (`utils/style.ts`) on the `img, canvas` rule. **GOTCHA:** CSS `filter` is a single property — a second `filter:` line overrides the first. Build ONE declaration: collect `invert(100%)` (dark+invert) and `contrast(${c}%)` (c!==100) into an array, join with spaces. invert/contrast commute so order is irrelevant. Contrast applies in light mode too (independent of dark/invert).
- **Local to current document:** `saveViewSettings(envConfig, bookKey, 'contrast', value, /*skipGlobal*/ true, /*applyStyles*/ true)`. `skipGlobal=true` forces the per-book branch (`applyViewSettings(bookKey)`) regardless of `isGlobal`, so it never touches `globalViewSettings`.
- **Re-apply on change:** add `viewSettings?.contrast` to the dependency array of the `FoliateViewer.tsx` effect (~L829) that calls `applyFixedlayoutStyles` on every rendered doc. New pages pick it up via the on-load `applyFixedlayoutStyles(detail.doc, viewSettings)` call (~L321). Re-render is driven by `setViewSettings` updating `bookDataStore` config → parent `BooksGrid` re-renders FoliateViewer.

Test: `src/__tests__/utils/fixed-layout-styles.test.ts` (new) asserts the combined `filter: invert(100%) contrast(150%)` and the no-filter-at-100% cases. The settings dialog `ThemePanel.tsx` was intentionally NOT touched — request was View menu only. Related: [[tap-to-open-image-table-4600]], css/style hub `src/utils/style.ts`.
