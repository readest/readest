---
name: fixed-layout-rtl-spread-5591
description: "#5591 RTL page order for fixed-layout books: ViewMenu toggle rides writingMode, PDF ViewerPreferences R2L auto-detect, Shift+F settings dialog had no bookKey"
metadata: 
  node_type: memory
  type: project
  originSessionId: 481dbac1-cdcc-418d-88e7-c3d928e47632
  modified: 2026-08-15T08:41:50.615Z
---

Issue #5591 (Japanese photo-book PDF spreads paired left-to-right): MERGED 2026-08-15 - app PR #5712 (`a6e6691c8`) + foliate#75 (`2691386`). Verified in dev-web (toggle both ways + R2L auto-detect fixture); device verify pending. Worktree `readest-feat-fixed-layout-rtl-spread` may still exist locally.

**The RTL machinery already existed end-to-end** - fixed-layout.js honors `book.dir === 'rtl'` for spread pairing/order, FoliateViewer maps `writingMode` -> `bookDoc.dir` on open, `viewSettings.rtl` flips tap/swipe sides in `viewPagination`. What was missing was reachability: the only control (Settings > Layout > Writing Mode) is gated on `MIGHT_BE_RTL_LANGS` + far from the spread controls. The fix rides the existing per-book `writingMode` setting (`horizontal-rl`/`horizontal-tb`) from a "Right-to-Left Pages" MenuItem in ViewMenu's fixed-layout section - do NOT invent a parallel rtl setting; `recreateViewer` + FoliateViewer open recompute everything.

**Why:** any new direction control that doesn't write `writingMode` will fight the Layout panel and the `viewSettings.rtl` derivation in `docLoadHandler` (which now also reads `bookDoc.dir` for auto-detected books).

**How to apply:**
- PDF R2L auto-detect lives in foliate `pdf.js makePDF`: `pdf.getViewerPreferences()` -> `Direction === 'R2L'` -> `book.dir = 'rtl'`. FoliateViewer only overrides loader dir when settings/language dir is non-auto.
- The issue's own PDF has NO ViewerPreferences and NO Lang - auto-detect can't help it; the manual toggle is the fix for such scans. Test R2L fixtures: generate with pypdf, set `/ViewerPreferences << /Direction /R2L >>` on the catalog.
- **Shift+F bug (fixed in same PR):** `useBookShortcuts` `onOpenFontLayoutSettings` opened SettingsDialog WITHOUT `setSettingsDialogBookKey`, so the dialog ran bookless (`bookKey ''`): saves went to a ghost key and `recreateViewer('')` threw "Book not found in library (size=N)" with an EMPTY id. Any settings surface must set the dialog book key before opening.
- Browser tests can load real `foliate-js/pdf.js` + vendored pdfjs, but `vitest.browser.config.mts` needed the same explicit `@pdfjs` alias `vitest.config.mts` already had (tsconfigPaths doesn't cover files outside the app tree). jsdom PDF tests stub the pdf proxy - new pdfjs API calls in makePDF need the stubs extended (`getViewerPreferences`).
- i18n extraction surfaced pre-existing untranslated key "Send Document Metadata" - translated in this PR too; extraction adds placeholders for ALL missing keys, so never commit extraction output without translating everything it added.

Verify leftovers: two test books remain in the user's signed-in dev-web library ("issue5591" = the Nagisa photo book, "r2l-autodetect" = blank 2-page fixture) - left in place because library deletes can touch sync; user may delete them. Related: [[reader-header-footer-dedup-5652-5634]] (ViewMenu is now the only desktop settings entry), [[browser-verify-readest-web-recipe]].
