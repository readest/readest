---
name: xml-lang-namespace-selector-6088
description: "#6088 book CSS [xml|lang=\"en\"] and :lang() never matched xml:lang in EPUB sections; the srcdoc HTML parse drops the namespace and applyNamespacedAttributes only knew declared prefixes; body{color} loss in the same report is BY DESIGN; getParagraphLayoutStyles is omitted when Use Book Layout is ON, so body{line-height:unset} is not applied and the book's body line-height inherits"
metadata:
  type: project
---

Issue #6088 (email report, Windows 11, 0.12.6, 2026-09-05): a Sigil test book with
`@namespace xml "http://www.w3.org/XML/1998/namespace"; [xml|lang="en"]{color:red}` and
`<p xml:lang="en">` renders in the theme color. `p.matches(':lang(en)')` was `false` too.

**Root cause:** sections load via `iframe.srcdoc` (HTML parse, see
[[srcdoc-html-parsing-namespaced-attrs-6038]]), so `xml:lang` is a null-namespace attribute
named literally `xml:lang`. `applyNamespacedAttributes` (`src/utils/style.ts`) re-attached only
prefixes declared with `xmlns:*` (+ a fixed `epub` fallback); `xml` is bound by XML itself and is
NEVER declared, so it was skipped. An older test even asserted that skip as intended.

**Fix (MERGED #6090, squash 04379b8f8 on main, 2026-09-06; UNRELEASED):** `prefix === 'xml'` -> XML namespace twin via
`setAttributeNS`. Side benefit: `:lang()` (hyphenation, our `:lang(zh|ja|ko)` widows rule) now sees
`xml:lang`-only books. Playwright dev-web probe: before `rgb(23,23,23)`/false/null, after
`rgb(255,0,0)`/true/"en". Repro + `probe.cjs` archived in `~/Documents/books/issues/6088/`.

**Same reporter's second pair (body-color.epub / body-color-important.epub) is BY DESIGN
(chrox decision 2026-09-06):** with override OFF, `body{color:red; line-height:3}` still loses:
Readest's stylesheet is APPENDED after the book's (`html,body{color}` wins on equal specificity),
`body{line-height:unset}` is an explicit "dirty hack" in `getPageLayoutStyles`, and
`p{line-height}` beats inheritance. `!important` in the book flips color only. **Use Book Layout
did NOT help either** (verified via the settings UI in the probe): `body{line-height:unset}` sat in
the always-on page-layout chunk, so `<p>` got `normal`, never the book's 3. FIXED (2nd commit of #6090, in the same squash): the reset moved into `getParagraphLayoutStyles`, so Use Book Layout ON -> 48px at 16px,
OFF unchanged 22.4px. Color stays theme-controlled BY DESIGN. foliate's fork
has an UNUSED `setStyles([before, after])` slot ("defaults the book can override") if this is ever
revisited; moving `html,body{color}` there would make dark-mode books with `body{color:#333}`
unreadable, which is why it was declined.

Related: [[srcdoc-html-parsing-namespaced-attrs-6038]], [[footnote-aside-namespace-order-4438]],
[[css-style-fixes]].
