---
name: book-meta-data-attrs-5776
description: "Issue #5776 FR, expose book title/series/series-index as data-* attrs on .sectioninfo and .header-title for Custom Reader UI CSS; committed on a worktree branch, NOT pushed, no PR yet"
metadata: 
  node_type: memory
  type: project
  originSessionId: 4b98a656-9818-4a58-b258-2daafec2fc01
  modified: 2026-08-20T17:16:40.277Z
---

Issue #5776 (FR by JamesHACS, 2026-08-18): Custom Reader UI CSS users want the
book's series name and index reachable via `attr()` on the running header and
the desktop HeaderBar title.

State: MERGED as #5806 (`01e2b6ba9`, 2026-08-21). Worktree and local branch
removed. Device check still PENDING (Custom Reader UI CSS attr() on a calibre
series EPUB; library `#n` badge after editing the index).

Design decisions (non-obvious):
- Shared helper `getBookDataAttributes(title, Pick<BookMetadata,'series'|'seriesIndex'>)`
  in `src/utils/book.ts`; spread onto `.sectioninfo` (SectionInfo.tsx) and
  `.header-title` (HeaderBar.tsx). Series attrs are `undefined` for standalone
  books so `[data-book-series]` presence checks work.
- Index emitted only when series exists and index is finite and > 0, mirroring
  `formatSeries`, because `readerStore` defaults a missing
  `calibre:series_index` to `parseFloat('0')` so 0 means "no position".
- Custom UI CSS is injected into `document.head` by `useUICSS`, so these
  app-document elements ARE reachable (book iframe is not).

**Why:** the user asked to "work on" the issue; I kept scope to exactly what the
issue specified (no default rendering change).

**How to apply:** if the issue author reports the attrs missing, check the
device (Settings > Misc > Custom Reader UI CSS with the CSS from the PR body).
`.header-title` is `hidden sm:flex`, so on phones users must still un-hide it
with their own CSS (the issue author already does).

Review-found pre-existing bug (fixed in #5806):
`useMetadataEdit.handleFieldChange` stored `seriesIndex`/`seriesTotal` as the raw
input STRING (`newMeta[field] = value`), so edited indices persisted and synced as
`"2"`; `formatSeries`'s `typeof === 'number'` gate then hid the library `#n` badge
and would have dropped `data-book-series-index`. Fix = coerce in the hook + shared
`getSeriesIndex(number|string)` in `src/utils/book.ts` used by both consumers.
Existing libraries still hold string indices; never reintroduce a strict
`typeof seriesIndex === 'number'` check. Index `0` remains unrepresentable
(readerStore/bookService default missing position to 0), pre-existing, OPEN.
The `/ship` skill's gstack bin paths (`~/.claude/skills/gstack/bin`) are stale
here; the install lives at `apps/readest-app/.claude/skills/gstack/`.
