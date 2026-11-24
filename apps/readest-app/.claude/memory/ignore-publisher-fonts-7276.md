---
name: ignore-publisher-fonts-7276
description: "#7276 Ignore publisher font names per serif/sans/mono MERGED #7298 (c296a204a) UNRELEASED; var(--book-<generic>, list) wrap; Chrome verify recipe"
metadata:
  node_type: memory
  type: project
  originSessionId: 449df464-d60c-4220-b294-386ad5ddba70
  modified: 2026-11-03T19:11:07.684Z
---

#7276 "Ignore publisher font names" merged 2026-11-04 as #7298 (c296a204a), UNRELEASED.

Design kept after the maintainer called the first version "too complicated" (it had a 136-line CSS tokenizer and a DOMParser round trip): a book list naming a generic is wrapped as `var(--book-serif, <book list>)` in `transformStylesheet`'s font-family rewrite. `getFontStyles` defines `--book-<f>: var(--<f>)` only for the categories in `ignorePublisherFonts` (an array setting), and never while Override Book Font is on. The first generic in the list picks the category. The `font` shorthand is parsed word by word (no backtracking regex; a quadratic one took 15 s on 50k spaces). `style` attributes go through `transformInlineFonts`, decoding `&quot;` to `"` and encoding it back.

Declined CodeRabbit findings (maintainer merged with them declined): no tokenizer for quoted names or comments; no nesting of later generics.

**Chrome verify recipe (dev-web in the user's real Chrome):** the import button opens a native picker, so copy the EPUB into `public/` temporarily, then `fetch` it, build a `File`, and dispatch a `DragEvent('drop', {dataTransfer})` on `.library-page`. Book iframes sit inside shadow roots, so walk `el.shadowRoot` recursively to find them. The user's Chrome localhost profile has a large library with Override Book Font ON; restore any settings you change. See [[verify-reader-chrome-needs-e2e]].
