---
name: se-text-wrap-pretty-justify-5582
description: "#5582 Standard Ebooks wide word gaps: authored text-wrap: pretty + reader justification overshoots gaps on Safari 26+/new Chromium; fixed by text-wrap-style: auto in getParagraphLayoutStyles"
metadata: 
  node_type: memory
  type: project
  originSessionId: 4a668e8a-0bee-4c5c-bda5-db36e63ec746
  modified: 2026-08-15T08:41:29.368Z
---

**#5582 Standard Ebooks EPUBs: wide word gaps in justified text.** SE's `core.css` template sets `body { text-wrap: pretty }`. Engines that apply `pretty` to justified text (Safari 26/Tahoe WebKit, recent Chromium ~142+) overshoot inter-word spacing when combined with Readest's default `fullJustification`, and the Word Spacing setting stops having visible effect. macOS 15 Safari never supported `pretty` — that's why it didn't repro there (not a Readest regression).

**Fix (MERGED #5718):** in `getParagraphLayoutStyles` (src/utils/style.ts), when `justify` is on emit `html, body, p, li, blockquote, dd { text-wrap-style: auto !important; }`. Visual verify on Tahoe/new Chromium pending (reporter confirmed the equivalent custom-CSS override fixes it on device).

**Why this shape:**
- `getParagraphLayoutStyles`, NOT `transformStylesheet` — book-CSS transforms run once at section load and go stale when the user toggles justification; `getStyles` regenerates on every settings change.
- The `text-wrap-style` **longhand**, not the `text-wrap` shorthand — preserves authored `text-wrap-mode: nowrap`.
- Scoped to text containers, not `*` — headings keep authored `text-wrap: balance` (legit for centered heads); `text-wrap-style` inherits, so forcing body covers SE's body-level declaration.
- Gated on `justify` — with ragged text `pretty` is harmless/desirable, so author intent survives when justification is off.
- Readest's generated `<style>` is appended at the END of `doc.head` (paginator styleMap), after author CSS, so equal-specificity ties already go to Readest; `!important` also beats higher-specificity author rules. `userStylesheet` is concatenated after paragraph styles, so users can still re-enable pretty with their own `!important`.

Regression test: `src/__tests__/utils/paragraph-justify-text-wrap.browser.test.ts` (computed-style assertions in real Chromium, mirroring the head injection order).

Note: the reporter's secondary complaint (Calibre-added soft hyphens breaking search) is a separate issue, made moot by this fix. Related: [[fxl-authored-colors-5649]], [[fxl-chrome-android-text-autosizing-5641]].
