---
name: blockquote-paragraph-margins-6656
description: #6656 Override Book Layout left blockquote-as-paragraph margins; MERGED #6759 (233e0eed1)
metadata:
  node_type: memory
  type: project
  originSessionId: 37309658-8088-4c28-aab8-295034f1f634
  modified: 2026-10-13T13:44:53.977Z
---

#6656: Calibre MOBI conversions (reporter's file: ~/Documents/books/issues/6656/) mark every paragraph as `<blockquote class="calibre9">` with `margin-left: 2em; margin-top: 0`. Override Book Layout only reset `p` margins, so text sat 2em off the left and Paragraph Margin had no effect.

Fix (2026-10-13, MERGED #6759 as 233e0eed1, UNRELEASED, not verified in the app): in `getParagraphLayoutStyles` the `p` margin rule also covers `blockquote:not(:has(*:not(INLINE_FORMATTING_SELECTOR)))` when override is ON. A quote wrapping block content (`<blockquote><p>`) keeps its indent. Test: `src/__tests__/utils/paragraph-blockquote-margin.browser.test.ts`.

**Why:** a blockquote that holds only inline content is used as a paragraph; one that wraps `<p>` is a real quote.
**How to apply:** if a report says "override doesn't reset margins", check which tag the book uses for its paragraphs (blockquote/div/dd) before changing `p` rules. Padding is still not reset (calibre9 had none). See [[paginator-scroll-fixes]].
