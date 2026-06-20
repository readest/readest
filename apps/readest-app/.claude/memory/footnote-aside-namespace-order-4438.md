---
name: footnote-aside-namespace-order-4438
description: Footnote aside border line regression — @font-face inlined before @namespace invalidated the namespaced footnote-hiding selector
metadata: 
  node_type: memory
  type: project
  originSessionId: 788943e6-fede-4c8f-828c-695ca873f178
---

#4438 (v0.11.4 regression): a stray horizontal line appeared below the footnote/annotation marker because the footnote `<aside epub:type="footnote">` (with the book CSS's `border:3px #333 double`) stopped being hidden.

**Root cause:** PR #4383 (`e8675fb7e`, inline custom @font-face) changed `getStyles` assembly in `src/utils/style.ts` from `${pageLayoutStyles}...` to `${customFontFaces}\n${pageLayoutStyles}...`. The `@namespace epub "..."` declaration lived *inside* `getPageLayoutStyles`. Per the CSS spec a `@namespace` rule is honored ONLY if it precedes every style/`@font-face` rule — a misplaced one is silently ignored. The inlined `@font-face` rules pushed `@namespace` down, invalidating it, so the namespaced selector `aside[epub|type~="footnote"] { display:none }` was dropped and the aside border showed. Only hit users **with custom fonts loaded** (otherwise `customFontFaces` is empty and `@namespace` stayed first).

**Fix:** Hoist `@namespace` to the very front of the assembled stylesheet (`const epubNamespace = '@namespace epub "..."'; return \`${epubNamespace}\n${customFontFaces}\n${pageLayoutStyles}...\``) and remove it from `getPageLayoutStyles`. Custom faces still precede the `--serif`/`--sans-serif` lists, preserving #4383's first-paint intent.

**Gotchas verified the hard way:**
- `epub:type` is a *namespaced* attribute only when the doc is parsed as XHTML/XML (foliate loads EPUB content as XHTML). Playwright `page.setContent` parses as **HTML**, where `epub:type` is a plain attr and `[epub|type~=...]` never matches — repro must use `data:application/xhtml+xml` via `page.goto`.
- The existing test `style-get-styles.test.ts` literally asserted the buggy order (`@font-face` before `@namespace`) on the false premise that an @font-face must precede the font-family rules that use it. It must not — @font-face rules are collected regardless of source position; only same-family redefinition cares about order.

Related: [[css-style-fixes]], [[table-dark-mode-tint-4419]] (both in the bug-prone `style.ts`).
