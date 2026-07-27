---
name: proofread-rule-change-font-loss-5277
description: "#5277 recreateViewer double-mounted the viewer, so transformStylesheet ran twice and killed every book font-family"
metadata: 
  node_type: memory
  type: project
  originSessionId: 932fbac2-7cd7-4d77-b36a-3cb17ce5d691
  modified: 2026-07-26T13:59:14.314Z
---

Issue #5277 ("增加/删除文字校对规则时，字体会改变"): with Override Book Font OFF,
adding/removing a proofread rule made the book render in the app-configured font
until the book was reopened. MERGED 2026-07-26 as PR #5345 (merge commit
`27d7a45d9`).

**Root cause (two stacked defects):**

1. `recreateViewer` (store/readerStore.ts) minted a `viewerKey` in the `.then()`
   *after* `initViewState` had already minted one at the end of its success
   path. React commits both, so `<FoliateViewer key={viewerKey}>` mounted
   **twice**. Verified live: `console.log('Opening book', …)` fired twice per
   recreate. The abandoned first mount keeps running its async `openBook()`
   (nothing cancels it, there is no unmount cleanup), appends its `foliate-view`
   to a detached container, and registers a second `data` listener on the
   **same** reloaded bookDoc's `book.transformTarget`. Listeners chain
   `detail.data = Promise.resolve(detail.data).then(...)`, so every CSS/XHTML
   resource runs the transform chain twice.
2. `transformStylesheet` (utils/style.ts) was not idempotent for generic
   families: `font-family: X, serif` -> `X, var(--serif, serif)` -> second pass
   matches the `serif` inside `--serif` (`-` is a word boundary) ->
   `var(--var(--serif, serif), serif)`. That is invalid, so the CSS parser drops
   the whole declaration: the book loses **every** font-family and inherits the
   reader's `html { font-family: var(--serif) }` = "the app's font". Reopening
   the book mounts once, so a single pass restores it.

**How to apply:** `recreateViewer` now just calls `initViewState`; never mint a
second viewerKey for the same reload. Keep `transformStylesheet` idempotent —
it parks `var(--x, x)` chunks behind `READEST_GF_<name>_PLACEHOLDER` (underscore
wrapped so `\b` cannot match inside) before the generic-family rewrites and
restores them after. No lookbehind (see [[feedback_no_lookbehind_regex]]).

**Debug recipe that cracked it:** in the web dev server, walk shadow roots to
find the section iframes, `fetch()` the book's `blob:` stylesheet href and grep
for `var(--var(` — 0 on a fresh open, >0 right after a recreate. Books whose CSS
has no `serif`/`sans-serif`/`monospace` keyword (many CJK books name their own
families) show no marker, which is why the first two repro books looked clean.

**Unrelated bug noticed while testing:** re-adding a book/library proofread rule
whose pattern was deleted earlier is a silent no-op. `ensureRuleId`
(utils/proofread.ts) derives the id from scope+flags+pattern, so the new rule
collides with the tombstone and `mergeProofreadRules`'s `{...l, ...r}` keeps the
old `deletedAt`. Not filed. Related: [[css-style-fixes]], [[bug-patterns]].
