---
name: progression-override-midload-render-6249
description: RTL page-progression override silently dropped when a re-render lands while a section's iframe document is committed but not loaded; collapses the section to pages===1 forever.
metadata:
  type: project
---

CI flake in `paginator-page-progression-direction.browser.test.ts:129`
("expected 1 to be greater than 1", run 35225091411, 2026-09-17) traced to a
REAL reader bug. foliate-js #99 MERGED (squashed to `25e398b`); readest #6249
MERGED 2026-09-17 as `ebc37a00b`, pinned to that sha. NOT device-verified — no
real RTL book with an LTR section was opened, only the browser suite.

**Root cause.** An iframe reports an incoming section as its `contentDocument`
the moment that document COMMITS, before its load event. `Paginator.render()`
(container ResizeObserver + every observed attribute change) renders each view
that already has a document, so a re-render in that window stamps
`direction: <progression> !important` onto a document whose own direction the
view has not read yet. `View.load()`'s handler then takes `#docDirection` from
`getComputedStyle(documentElement).direction` — reading back OUR OWN override —
so `#setProgressionDirection` forever takes the "document already agrees,
remove the override" branch. Regression from #6197 ([[page-progression-direction-6197]]).

**Fix:** `View.render()` returns early while `this.document !== this.#loadedDoc`
(set next to the `#docDirection` capture). Never write to a document before its
own direction is known; the load handler renders it a moment later anyway.

**Why pages===1 and why it never recovers.** With the override gone the columns
run LTR against an RTL scroll, so in `expand()`'s RTL branch
`contentStart = rootRect.right - contentRect.right` goes sharply negative and
cancels the content width to ~one column:
`760 - 7547.5 = -6787.5`, `-6787.5 + 7494.9 = 707.4`, `ceil(707.4/760) = 1`.
The next `expand()` re-measures the same geometry — a FIXED POINT, not a
transient. So `pages === 1` stuck is the signature of "columns run against the
scroll", and polling/waiting longer can never fix such a test.

**Repro recipe (reusable for load-window races).** Spin `Paginator.render()` via
`el.setAttribute('max-inline-size', ...)` from a `MessageChannel` callback that
re-posts to itself until `goTo()` resolves. `setTimeout(...,0)` is clamped to 4ms
and stepped over the window (5/8); MessageChannel hit it 8/8.

**Diagnosing signature** (dump on failure): `bodyDirInline: ""` +
`htmlDirComputed: "ltr"` + `colWidth: "654px"` + `rangeRect.right` far past
`htmlRect.right` ⇒ override missing, layout otherwise fine.

**Finding a browser-suite flake locally:** run the WHOLE suite in a loop
(`vitest run --config vitest.browser.config.mts`), not the single file — the
single file passed 40/40 in isolation. Hit rate was ~1 in 6 full-suite runs on
an 8-core mac; 0 in 10 after the fix. Stacking background waiter processes
alongside the loop got them all killed for memory pressure — run one loop, poll
it cheaply. Other browser tests (`dialog-close-frames`,
`overlayer-highlight-page-bounds`, `paginator-turn-styles`,
`paginator-background-anim-perf`, `captured-turn`) flake locally under that
contention and are unrelated noise.
