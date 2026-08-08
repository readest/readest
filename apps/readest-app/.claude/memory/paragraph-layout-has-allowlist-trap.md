---
name: paragraph-layout-has-allowlist-trap
description: Injecting any element into a div paragraph silently kills its line-height/indent — the :has() allowlist in getParagraphLayoutStyles must contain the injected tag
metadata: 
  node_type: memory
  type: project
  originSessionId: 23d24f5c-e4dc-482d-b692-69a990218a23
  modified: 2026-08-07T09:44:31.353Z
---

`getParagraphLayoutStyles()` in `src/utils/style.ts` emits:

```css
p, blockquote, dd, div:not(:has(*:not(b, a, em, i, strong, u, span, font))) { line-height … }
```

The `div` clause treats a div as paragraph-like **only when every descendant is an inline
formatting tag on that allowlist**. So injecting any element whose tag is not on the list —
anywhere inside a div paragraph — makes `:has()` fire, the `:not()` fail, and the div silently
drop the *whole* rule: line-height, word/letter-spacing, text-indent and hyphenation all revert
to the book default. Nothing errors; the paragraph just looks wrong.

This has now bitten three times:

1. **a11y skip link** — fixed by injecting a `<span>` (already allowlisted); `a11y.ts` carries a
   comment explaining exactly this, and `a11y.browser.test.ts` locks it.
2. **Translation targets** (2026-08-07) — `createTranslationTargetNode` appends `<font>`
   wrappers, so every `<div>` paragraph lost its line spacing the moment translation was turned
   on. Fixed by adding `font` to the allowlist.
3. **Books that use `<font>` themselves** — same latent bug with no translation involved; older
   converted EPUBs style runs with `<font>`. The same one-word fix covered it.

Diagnosing it: read `getComputedStyle(para).lineHeight` — a bare `normal` on a div paragraph is
the tell. Confirm with `para.matches(<the selector>)`, then remove the injected child and watch
line-height snap back. Needs a real `:has()` engine, so tests must be `*.browser.test.ts`.
Regression tests: `paragraph-layout-translation.browser.test.ts` (uses the real emitted CSS via
`getStyles`, not a copy of the selector). Note `a11y.browser.test.ts` duplicates the selector
string — keep the two in sync.

**Rule for future injections:** either inject a tag already on the allowlist, or add yours to it.
Prefer `<font>` over `<span>` for injected non-book content: `<font>` is obsolete markup that
book CSS essentially never targets, so translations do not inherit the book's `span { }` rules.

Related: the wrapper tag is irrelevant to CFI — see [[translation-cfi-stability]].
