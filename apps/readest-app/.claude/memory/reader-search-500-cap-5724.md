---
name: reader-search-500-cap-5724
description: "#5724 reader in-book search silently stopped at 500 matches because it shares the library scan's per-book cap; fixed by a maxResultsPerBook option"
metadata:
  type: project
---

Issue #5724: searching inside a book stopped at exactly 500 matches with no
"500+" marker. Cause: PR #5389 rewired reader search onto `searchLibraryBooks`,
which enforces `MAX_BOOK_SEARCH_RESULTS = 500` per book so one book cannot flood
a library-wide sweep. The reader inherited that budget.

Fix MERGED as PR #5728 (2026-08-16; worktree and branch cleaned up):
`LibrarySearchOptions.maxResultsPerBook` defaults to 500 for the library scan;
`src/app/reader/components/sidebar/SearchBar.tsx` passes `Infinity`.

**Why:** maintainer ruled the cap an unintended side effect - single-book
full-text search must return every match.

**How to apply:** `Infinity` is already the no-limit default in every matcher
(`findContainsMatches`, `filterWholeWordMatches`, `findRegexMatches`,
`findFuzzyMatches`, `findNearbyMatches`) and survives worker `postMessage`
(structured clone), so no matcher needed changing. Watch the downstream cost:
reader `SearchResults.tsx` renders `results.map` with NO virtualization, and
foliate `view.search` adds one annotation per CFI, so a common word in a long
book now materializes every match in the DOM. If that bites, virtualize the
sidebar list rather than reintroducing a cap.

Related: [[pr-5389-library-search-review]]
