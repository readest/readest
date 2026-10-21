---
name: quote-card-5830
description: "#5830 quote card image sharing — MERGED #6701 (601e57866) UNRELEASED; canvas renderer, rendered-text runs, QR-only \"via Readest\" signature, chrox's design calls"
metadata:
  node_type: memory
  type: project
  originSessionId: c4102648-f37c-4085-92da-28ac18f9a81f
  modified: 2026-10-10T05:48:28.293Z
---

Quote Card (selection toolbar, opt-in) MERGED as #6701 (601e57866, 2026-10-10). Fresh implementation; the #5830 reporter (novel-byte) had a fork prototype (html-to-image) — credited via Co-authored-by, code not reused.

Non-obvious facts:
- `getTextFromRange` copies raw text-node values: some EPUBs (Ultimate Bible Study Suite KJV) put source newlines between every word, and hidden translations (`.translation-target.hidden`, display:none) are included. Quote cards use `getRenderedRunsFromRange` (sel.ts): CSS-like whitespace collapse, skips display:none/ruby, returns bold/italic runs. Copy still has the raw-newline issue — UNFIXED, out of scope.
- Canvas 2D chosen over DOM snapshot because foreignObject rasterizing is flaky in WKWebView.
- A book's author can sync down as a lone U+200B; layouts strip zero-width chars before deciding a field is empty.
- Native share/gallery/clipboard paths NOT verified on macOS/iOS/Android/Windows — only web dev build.

chrox's design decisions (keep if iterating): QR on by default; signature "via Readest" (translated `via {{app}}`, brand untranslated) shown ONLY with the QR code; no app icon (too small); signature uses the chapter/date font+color; QR cover-height in card colors on a faint tile with 4-module quiet zone; Classic footer centered between rule and bottom edge; fonts follow Settings → Font.

**Why:** chrox iterated these live on the card for an X post of Acts 8:30–31 (the verse Readest is named after).
**How to apply:** treat these as settled when changing quote cards; verify on native before release. Related: [[share-feature]], [[annotation-share-toolbar-4014]].
