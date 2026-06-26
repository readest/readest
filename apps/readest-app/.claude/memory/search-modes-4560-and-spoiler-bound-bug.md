---
name: search-modes-4560-and-spoiler-bound-bug
metadata: 
  node_type: memory
  type: project
  originSessionId: c416114a-72e6-40ed-a3ed-4b2d5fd7d5f4
---

**#4560 (Calibre-parity search)** was scoped down via `/autoplan` review (both Codex + Claude
agreed the original "foundational Turso-cached engine + searchBook agent tool" was over-scoped).
Decision = **phase it**.

**PR-1 (MERGED: readest#4764 + foliate-js#38):**
adds `regex` + `nearby-words` modes INSIDE the foliate submodule `packages/foliate-js/search.js`
(`regexSearch`, `nearbyWordsSearch`, `mode` dispatch in `search()`/`searchMatcher`); per-word `cfis`
+ annotation dedupe in `view.js`; `BookSearchConfig.mode`/`nearbyWords` + `BookSearchMatch.cfis` +
`SearchExcerpt.segments` in `types/book.ts` (schema v2→v3 in `serializer.ts`, `utils/searchConfig.ts`
helper); sidebar mode selector + greyed modifiers + "within N words" stepper + `searchError` state +
segmented excerpt. Nearby distance = **words** (default 10), via a control — NOT chars, NOT a trailing
number in the query. **foliate-js is a submodule** — search.js/view.js changes must be committed in
the submodule first, then the parent pointer updated.

**Deferred:** PR-2 = perf cache (only if measured; neutral `search.db`, NEVER `reedy.db` — that DB is
opt-in/desktop-gated and its delete-cleanup wouldn't run for non-AI users; FTS ngram is NOT a
guaranteed superset so it must fall back to full scan; run regex in a Web Worker for real backtracking
isolation). PR-3 = `searchBook` agent tool.

**Pre-existing bug to fix in PR-3:** `lookupPassage` spoiler protection is already wrong — it passes
`currentPage` (a rendered page ordinal, `AIAssistant.tsx`) as `spoilerBoundPosition`, but `ReedyDb`
compares it to `c.position_index`, a **global chunk ordinal** (`positionIndex: all.length`,
`BookIndexer.ts`). Page count ≠ chunk count, so the bound is off. Fix searchBook (and lookupPassage)
to spoiler-bound by the current **CFI → (sectionIndex, charOffset)**, not a position integer.
Related: [[koplugin-stats-sync]] is unrelated; see plan at
`~/.claude/plans/the-search-might-be-glistening-mccarthy.md`.
