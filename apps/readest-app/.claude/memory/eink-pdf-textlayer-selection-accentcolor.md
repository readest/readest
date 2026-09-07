---
name: eink-pdf-textlayer-selection-accentcolor
description: "PDF text selection ignores the e-ink ::selection inversion because pdf.js's `.textLayer ::selection` outranks Readest's bare `::selection`"
metadata: 
  node_type: memory
  type: project
  originSessionId: a0277d08-901d-4dda-be8a-19be816afdfa
  modified: 2026-09-06T06:46:45.304Z
---

Support case EINK-PDF-01: on e-ink, selecting a word produces ghosting and a grey
dither that makes the selected text illegible. Selection needs high contrast with
100% solid backgrounds.

**Verified on the Boox Leaf5 with a sample PDF.**

**Root cause (CONFIRMED).** `getEinkSelectionStyles()` in `src/utils/style.ts` injects a
bare `::selection { color: var(--theme-bg-color); background: var(--theme-fg-color) }`
into the book document, and it is present in the PDF iframe too. But pdf.js's own
stylesheet, loaded first in that same iframe, carries

    .textLayer ::selection { background: color-mix(in srgb, AccentColor, transparent 75%); }

`.textLayer ::selection` outranks the bare selector on specificity, so **every PDF
selection paints as 25%-opacity system AccentColor** — a translucent lavender/teal wash
over still-black text. That is the reporter's "grey dithering", and it is exactly what a
B&W panel cannot render. The same selection in an EPUB inverts correctly to solid
black-on-white, which is why this reads as PDF-only.

**Fix (verified live).** Injecting
`.textLayer ::selection{color:var(--theme-bg-color)!important;background:var(--theme-fg-color)!important}`
into the PDF iframes turned the selection into a solid black block with white text,
matching the EPUB. Not committed — verification only.

**Second finding: the toolbar chrome is already correct.** In e-ink mode the selection
popup is solid `bg-base-100` with a 1px `base-content` border and no shadow
(`not-eink:shadow-2xl` etc. all behave). The reporter's photos show a *grey translucent
panel with a drop shadow*, which reproduces only with **E-Ink Mode OFF** — so his install
is probably not in e-ink mode at all. Auto-detection exists
(`src-tauri/src/android/eink.rs`, ONYX/`leaf` both match, sets `window.__READEST_IS_EINK`)
but `loadSettings` merges as `{...getDefaultViewSettings(ctx), ...settings.globalViewSettings}`
— **the stored value wins**, so any settings file written before the detection shipped
(2026-01-08, #2887) keeps `isEink: false` forever with no prompt.

**Third finding: the teal selection handles are the system's.** Readest renders its own
`Handle` (e-ink-coloured) only when `selection.handlesSuppressed` is set, which happens
only for lookup surfaces. A plain toolbar selection keeps the Android WebView's native
handles, drawn in the platform accent colour, and they stay bright teal on e-ink.

**Also seen, not chased:** PDF-embedded link colours stay blue on e-ink (the
`[class*='text-blue']` rules only touch Tailwind classes, not PDF content), and with Color
E-Ink Mode ON body text renders grey rather than black.

**Device gotchas.** The Leaf5 had **Color E-Ink Mode ON** (wrong for a mono Carta panel) —
that alone keeps full-colour swatches, grey text and a translucent selection, so check it
before blaming code; restored as found. Instant Dictionary was on, which swallows the
long-press before the toolbar can appear — turn the quick action off to see the toolbar.
`adb shell input swipe x y x y 900` does NOT long-press; `input motionevent DOWN/UP` with a
`sleep` between them does, and CDP `Input.dispatchTouchEvent` does not drive Android's
native text-selection gesture at all. `curl` to the forwarded devtools port needs
`--noproxy '*'` or the SOCKS proxy eats it.

Related: [[feedback-always-verify-on-xiaomi]], [[eink-highlight-difference-mask-5667]],
[[eink-per-device-css-data-eink-5795]], [[eink-class-substring-matchers]]
