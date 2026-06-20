---
name: empty-start-cfi-sync
description: "Invalid synced-progress CFIs like epubcfi(/6/24!/4,,/20/1:58) — the empty-start range bug from the cfi-inert skip-link, and the read-side normalizeLocationCfi sanitizer"
metadata: 
  node_type: memory
  type: project
  originSessionId: ffa4a291-55fa-4cd5-8e35-0ac2852ff5c9
---

Synced progress CFIs of the form `epubcfi(/6/24!/4,,/20/1:58)` (a range with an
**empty start** component — the `,,`) are invalid: the start collapses to the
section beginning `(body, 0)` while the end reaches the section's last block, so
a receiving device navigates to the **wrong end** of the section.

**Root cause** — the cfi-inert a11y skip-link (`a11y.ts` prepends a 1×1
`position:absolute` `<div cfi-inert>` as body's first child). There was a
~2.5-month transitional window (foliate `c558766` 2026-03-11 → `569cc06`
2026-05-30) where `epubcfi.js getChildNodes` already skipped `cfi-inert` but
`paginator.js getVisibleRange` did **not** yet reject it. The relocate range's
START could anchor on the skip-link; `fromRange`→`nodeToParts` asks for its
index, `getChildNodes` filters it out, `findIndex` returns -1, the
`.filter(x => x.index !== -1)` drops the step, and the start collapses to the
body boundary → empty start. (Symmetric empty-END form from the next-section
skip-link on a section's last page.)

**Generation is fixed** by `569cc06` (live on `dev` via `c23c21d37`) — but that
does NOT repair CFIs already stored on the sync server. Those keep being served.

**Fix (this work):** `isMalformedLocationCfi(cfi)` predicate in `src/utils/cfi.ts`
— true for a degenerate range (empty `parts.start` or `parts.end` via
`CFI.parse`). Chose **discard over repair** (user call): don't derive a position
from a corrupt CFI; drop it and let a known-good fallback win.
- Applied ONLY at `useProgressSync.ts` `applyRemoteProgress`: a malformed
  `syncedConfig.location` is set to `undefined` so it can't drive goTo, can't win
  the `CFI.compare` gate, and is filtered out of the persisted config (local
  location kept; stops re-propagation). A valid `xpointer` still recovers the
  real position via `getCFIFromXPointer`.
- Applied at `useKOSync.ts` `generateKOProgress` (push side): if local
  `progress.location` is malformed, skip the CFI→XPointer conversion and reuse
  the last known-good `config.xpointer`. Critical because once a bad CFI is
  pushed as an XPointer the "malformed" signal is lost — other devices pull a
  plain XPointer pointing at the wrong section end and can't discard it. The
  kosync RECEIVE path needs no guard: `getCFIFromXPointer` builds point CFIs from
  point XPointers, which can't take the empty-start form.
- Deliberately NOT applied to `FoliateViewer.tsx` open path — that uses the
  user's OWN local `config.location`; discarding it would dump them at book start
  (`goToFraction(0)`). Left untouched per user preference; a legacy local bad
  value self-heals on the next page-turn save.

Tests: predicate in `__tests__/utils/cfi.test.ts`; repro + flag in
`__tests__/utils/epubcfi-inert.test.ts`; discard behavior (no goTo, not
persisted) in `__tests__/hooks/useProgressSync.test.tsx`.
Related: [[kosync-cfi-spine-resolution]].
