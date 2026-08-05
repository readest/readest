---
name: customize-toolbar-eink-black-bar-4839
description: Customize Toolbar preview rendered as a solid black bar in e-ink; preview surfaces copying bg-gray-600 need eink-bordered
metadata: 
  node_type: memory
  type: project
  originSessionId: 1fe6ab52-3346-454d-8ea3-a6d970fe0db0
  modified: 2026-08-05T03:25:41.999Z
---

#4839: the Customize Toolbar sub-page (`AnnotationToolbarCustomizer.tsx`) toolbar **preview** Zone copied the live popup's `selection-popup bg-gray-600 text-white` but rendered as an unreadable solid black bar under `[data-eink='true']`.

**Why:** the real reader popup earns its e-ink chrome from `.popup-container` (globals.css `[data-eink] .popup-container` → `bg base-100` + 1px `base-content` border). The preview Zone is a plain `<div>` with NO `popup-container`, so the dark `bg-gray-600` survived in e-ink; the base-content (inverted via `[data-eink] button`) chip icons then sat black-on-black.

**How to apply:** any e-ink "preview" surface that mimics the live popup must scope the dark fill to non-e-ink (`not-eink:bg-gray-600 not-eink:text-white`) and add `eink-bordered` so e-ink renders it as `bg-base-100` + 1px `base-content` border (don't just rely on `eink-bordered`'s `!important` to override the gray — drop the gray in e-ink outright). Also fix copied white hint text (`text-white/70` → `not-eink:text-white/70 eink:text-base-content`) since the surface turns base-100. Chip icons need no change — they are `<button>`s, already inverted to base-content by the global `[data-eink] button` rule. Guard: render test asserts `.selection-popup` element carries `eink-bordered`. Verify rendered colors via `getComputedStyle` under `[data-eink]` (set `data-theme='default-light'` first or theme vars are unresolved → transparent); note daisyUI returns **oklch** not rgb — e-ink correct = bg `oklch(1 0 0)`, border/icon `oklch(0.2 0 0)`. PR #4841.

**Update (PR #5496, merged 2026-08-05): the `not-eink:bg-gray-600 not-eink:text-white` advice above is superseded.** The preview now mirrors `Popup.tsx`'s real chrome with theme tokens (`bg-base-300 theme-dark:bg-base-100`, `text-base-content`, `border`, `not-eink:border-base-content/20`, `not-eink:shadow-2xl`) **plus `eink-bordered`**, and the hint is plain `text-base-content/50` with no `text-white` anywhere. A contributor swapped in the popup classes but dropped `eink-bordered`, which re-broke #4839 and failed the guard test — the classes alone are not enough, because the preview is not a `.popup-container`. Two live gotchas when re-verifying: a probe injected with the OLD class names measures wrong (Tailwind no longer emits those rules, so it silently inherits), and toggling `data-eink` on `document.documentElement` leaves the theme visually recomputed — reload rather than toggling back.

Same feature as [[customize-toolbar-global-serializeconfig]]; e-ink conventions in [[feedback_design_system_doc]]; the wider contract in [[popup-chrome-family-5496]].
