# feat: merge upstream changes with replacement feature

## Description

This PR merges the latest changes from the upstream repository (`readest/readest`) into our fork while preserving all the replacement feature work completed by the team. This ensures our fork stays up-to-date with upstream improvements including OPDS catalog enhancements, comic book layout fixes, TTS improvements, IAP billing fixes, and other bug fixes and features.

**Key achievements:**
* Successfully merged 9 new commits from upstream/main without conflicts
* Preserved all replacement feature functionality and commits
* Updated submodule dependencies (foliate-js) to match upstream
* Maintained compatibility between replacement feature and upstream changes

## Changes

### Upstream Changes Merged:
* **OPDS improvements**: Added Standard Ebooks catalog, fixed OPDS search link selection
* **Comic book support**: Fixed layout for comic books
* **TTS enhancements**: Avoided false default English language code for TTS
* **IAP improvements**: Don't initialize billing on Android without Google Play service
* **Authentication**: Fallback to Basic auth if no WWW-Authenticate challenge in OPDS response headers
* **Layout refactoring**: Refactored page margins for pixel precision
* **Koplugin updates**: Added version info in meta file, repackaged for updater
* **Translation updates**: Updated all locale files with latest translations

### Replacement Feature Work Preserved:
* Text replacement functionality for EPUBs
* Replacement rules management (single-instance, book-scope, global-scope)
* Whole-word matching support with `\b` boundaries
* Non-cascading replacement logic (prevents re-matching own replacements)
* Grayed-out replacement button for non-EPUB formats
* Comprehensive test coverage for replacement functionality
* UI components: ReplacementRulesWindow, ReplacementOptions, ReplacementPanel

### Files Modified:
* All locale translation files (28 languages)
* OPDS-related components and utilities
* TTS language detection logic
* IAP/billing components
* Comic book layout handling
* Replacement transformer and related components
* Test files for replacement functionality
* Submodule: `packages/foliate-js` updated to latest upstream version

## Validation

### Validation Method 1: Automated Testing

1. `cd ~/readest/apps/readest-app`
2. Run `pnpm test` to ensure all existing tests pass
3. Run `pnpm test components/ReplacementOptions.test.tsx` to verify replacement feature tests
4. Run `pnpm test utils/replacement.test.ts` to verify replacement transformer tests

### Validation Method 2: Manual Testing

**Part 1: Replacement Feature Still Works**
1. Open the Web app in development mode
2. Open an EPUB book in the reader
3. Navigate to a page with text
4. Highlight a word and test text replacement functionality:
   - Create a single-instance replacement
   - Create a book-scope replacement
   - Create a global-scope replacement
5. Verify that:
   - Replacements apply correctly
   - Whole-word matching works (e.g., "and" doesn't replace "England")
   - No cascading replacements occur
   - Replacement button is grayed out for non-EPUB formats

**Part 2: Upstream Features Work**
1. Test OPDS catalog functionality:
   - Navigate to OPDS section
   - Verify Standard Ebooks catalog is available
   - Test search functionality
2. Test comic book support (if available):
   - Open a comic book
   - Verify layout displays correctly
3. Test TTS functionality:
   - Verify language detection works correctly
   - Test text-to-speech on various languages
4. Verify other upstream improvements work as expected

**Part 3: Integration Testing**
1. Verify replacement feature works alongside new upstream features
2. Test that no regressions were introduced
3. Confirm all UI components render correctly
4. Test cross-feature interactions (e.g., replacement + OPDS, replacement + TTS)

### Validation Method 3: Code Review Checklist

- [x] All upstream commits merged successfully
- [x] No merge conflicts
- [x] Replacement feature code preserved
- [x] Submodule updated correctly
- [x] Translation files updated
- [x] Test suite passes
- [x] No breaking changes to replacement API
- [x] Code follows project conventions

## Notes

* This is a merge commit combining upstream/main with our replacement feature branch
* All replacement feature work from previous PRs (#5, #6, #8) is included
* The merge was conflict-free, indicating good separation of concerns
* Future upstream updates can be merged using the same process

