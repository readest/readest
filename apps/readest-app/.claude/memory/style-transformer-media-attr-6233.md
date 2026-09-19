---
name: style-transformer-media-attr-6233
description: "#6233 blank pages from <style media=print> — style transformer rebuilt <style> bare, dropping media/type attrs; MERGED #6270 (226a31648) replays attrs; floated-image half of the issue untouched"
metadata:
  type: project
---

Issue #6233 (2026-09) has TWO halves. Half 1: every content page went blank because
`src/services/transformers/style.ts` rewrote each `<style ...>` as a bare `<style>` after
`transformStylesheet`, so `<style media="print">.noprint{display:none}</style>` paired with
`<body class="noprint">` applied on screen. PR #6270 (jadhavgaurav, MERGED 2026-09-18 as 226a31648, UNRELEASED) captures
the opening tag's attrs and replays them. Verified: 2 new tests fail on main's transformer, pass on
the branch; DOMPurify in the sanitizer keeps `media`/`type` on `<style>`; foliate `loadDocument` only
rewrites `<style>` textContent. NOT browser-verified (reporter never shared the EPUB).

Half 2 (floated `div{width:30%;float:right}` images "too small" in paged mode) is NOT addressed, but
the commit says `Fixes #6233`, which auto-closes the whole issue on merge. Percent widths resolve
against the COLUMN box in multicol, so a 2-column iPad page halves them vs Calibre; may be by design.

**Why:** the transformer regex `<style([^>]*)>` is the only place attrs were lost; CodeRabbit's
quote-aware regex nit (`>` inside a quoted attr value) is a pre-existing limitation, not a regression.

**How to apply:** #6270 merged with `Fixes #6233`, so #6233 is likely auto-closed with the floated-image
half uninvestigated; reopen or split it before looking into it. Any future `<style>`/`<link>` rewrite in a transformer must round-trip attributes.
