---
name: override-layout-collapses-pre-whitespace
description: "overrideLayout is not CSS-only — it also rewrites the raw section HTML via whitespaceTransformer, which collapsed <pre> indentation"
metadata: 
  node_type: memory
  type: project
  originSessionId: afe33969-39c8-449b-a266-e364f1e10e56
  modified: 2026-08-07T07:30:09.642Z
---

"Override Book Layout" (`viewSettings.overrideLayout`) looks CSS-only: grepping
`overrideLayout` hits `src/utils/style.ts`, `LayoutPanel.tsx`, `constants.ts`,
`types/book.ts` and nothing else. That is a trap. It is **also** read by
`src/services/transformers/whitespace.ts`, which rewrites the raw section HTML
string before it reaches the iframe.

Reported 2026-08-07, MERGED #5549: with override ON, code blocks lost their indentation
(4/8-space nesting rendered flush-ish left, one space per level). Root cause was
`.replace(/ {2,}/g, ' ')` applied to the whole document string, including inside
`<pre>`. Fixed by skipping `<(pre|code)...>...</\1>` regions — both are forced to
`white-space: pre-wrap !important` by `getPageLayoutStyles`, so their space runs
are load-bearing indentation, not the fake `&nbsp;` spacing the transformer
exists to normalize.

**Why:** the visual symptom (runs of spaces → single space, newlines kept) reads
exactly like a CSS `white-space: pre-line` regression, so the instinct is to hunt
stylesheets. It was a string mutation several layers upstream.

**How to apply:**
- The decisive diagnostic is `iframe.srcdoc` vs `pre.textContent`. foliate-js
  loads sections via `about:srcdoc`, so `f.srcdoc` is the pre-parse source. If
  srcdoc already differs between two settings, the bug is in a transformer, not
  in CSS and not in a DOM mutation. Frames live behind shadow roots — walk
  `el.shadowRoot` recursively to find them.
- `src/services/transformers/` runs an ordered pipeline over section HTML
  (`index.ts`). Any of them can silently mutate book text. Check it before
  concluding "setting X only affects CSS".
- Chrome's `javascript_tool` refuses to return page markup containing
  querystring-ish data — return derived measurements (indent counts, booleans),
  not raw `outerHTML`.

Related: [[stale-format-gates-in-settings]], [[css-style-fixes]]
