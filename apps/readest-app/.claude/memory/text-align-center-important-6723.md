---
name: text-align-center-important-6723
description: "#6723 transformStylesheet's center+indent-0 !important beat more specific left-align rules; MERGED #6763 2026-10-13, UNRELEASED"
metadata:
  node_type: memory
  type: project
  originSessionId: 51d9c665-6be1-4ded-8b70-2e54d28ed3df
  modified: 2026-10-13T14:55:09.144Z
---

#6723: book `h1, h2 { text-align: center; text-indent: 0 }` was rewritten by `transformStylesheet` to `text-align: center !important`, which beat the more specific `.vsides { text-align: left }`, so the headings rendered centered. Fix (MERGED #6763 2026-10-13): pin only `text-indent: 0 !important` and let `keepTextAlignment` (added in #2254) keep centered p/div/blockquote/dd centered under Override Book Layout. Covered by `src/__tests__/utils/text-align-center-specificity.browser.test.ts`.

**Why:** the center `!important` dates from #1105 (May 2025), before `keepTextAlignment` existed, so it no longer did any useful work.
**How to apply:** known caveat: a bare `body { text-align: center; text-indent: 0 }` now loses to Readest's later `html, body { text-align: var(--default-text-align) }`, the same as `body { text-align: center }` without the indent already did. If a centered title page regresses, look there. See [[css-style-fixes]].
