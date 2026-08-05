---
name: popup-chrome-family-5496
description: "Reader popups share Popup.tsx chrome; the .popup-container class is load-bearing for e-ink, nested cards must not re-add the border, and Popup caps height without clipping"
metadata: 
  node_type: memory
  type: project
  originSessionId: 1fe6ab52-3346-454d-8ea3-a6d970fe0db0
  modified: 2026-08-05T03:25:30.747Z
---

Every reader popup (annotation toolbar, translator, proofread, dictionary, note cards) is a `Popup` from `src/components/Popup.tsx`, whose container carries:

```
popup-container text-base-content rounded-lg border font-sans
not-eink:border-base-content/20 not-eink:shadow-2xl
bg-base-300 theme-dark:bg-base-100
```

**Why:** three separate defects in PR #5496 all traced to code that copied *part* of this contract.

**How to apply:**

- **The `popup-container` class name is load-bearing, not decorative.** `globals.css` `[data-eink='true'] .popup-container` is what supplies the e-ink surface. Copying the Tailwind classes onto a plain `<div>` without the class name silently loses e-ink. Use `eink-bordered` on such surfaces instead (same result: base-100 fill + 1px base-content border, `!important` so it beats `bg-base-300`). See [[customize-toolbar-eink-black-bar-4839]].
- **Once a surface uses theme tokens, drop the `eink:` color overrides.** `not-eink:text-white eink:text-base-content` only existed because the fill was a hardcoded dark gray; with `bg-base-300 theme-dark:bg-base-100` a plain `text-base-content` is correct in light, dark and e-ink alike.
- **A card nested inside a `Popup` must NOT add its own border.** `AnnotationNotes` cards sit inside a `bg-transparent` Popup shell that still draws the bubble outline the triangle geometry aligns to. Adding a second border doubles the line along the triangle side (measured: card bottom 295, shell bottom 296, triangle attaching at 296). Keep `not-eink:shadow-lg` + the bg tokens, no `border`.
- **`Popup` applies `maxHeight` but never clips.** `maxHeight` comes from the room above the selection (`trianglePosition.point.y - popupPadding` when `dir === 'up'`), which can be far smaller than the content; `overflow` stays `visible`, so children just paint outside the rounded box. ProofreadPopup hit this (220px available vs 262px of content) and its scope row hung past the bottom edge. Fix shape, same as TranslatorPopup already uses: `overflow-hidden` on the popup, `min-h-0 flex-1 overflow-y-auto` on the body, `shrink-0` on the row that must stay reachable.
- **`@/components/Select` is `bg-transparent`** so it takes whatever surface it sits on. Only TranslatorPopup (3x) and ProofreadPopup (1x) use it. Don't reintroduce a `bg-*` in its base string, and don't try to override it per call site — Tailwind emits both utilities in the same layer, so which one wins depends on stylesheet order, not class-attribute order.

Verify with `getComputedStyle` against a real popup rather than by eye; daisyUI returns **oklch**, not rgb. Matching means identical background, border width/color, radius, text color, font and shadow. E-ink conventions in [[feedback_design_system_doc]]; triangle border-box quirk in [[popup-triangle-borderbox-eink]].
