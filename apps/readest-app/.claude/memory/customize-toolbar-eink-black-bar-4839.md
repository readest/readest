---
name: customize-toolbar-eink-black-bar-4839
description: Customize Toolbar preview rendered as a solid black bar in e-ink; preview surfaces copying bg-gray-600 need eink-bordered
metadata:
  type: project
---

#4839: the Customize Toolbar sub-page (`AnnotationToolbarCustomizer.tsx`) toolbar **preview** Zone copied the live popup's `selection-popup bg-gray-600 text-white` but rendered as an unreadable solid black bar under `[data-eink='true']`.

**Why:** the real reader popup earns its e-ink chrome from `.popup-container` (globals.css `[data-eink] .popup-container` → `bg base-100` + 1px `base-content` border). The preview Zone is a plain `<div>` with NO `popup-container`, so the dark `bg-gray-600` survived in e-ink; the base-content (inverted via `[data-eink] button`) chip icons then sat black-on-black.

**How to apply:** any e-ink "preview" surface that mimics the live popup must scope the dark fill to non-e-ink (`not-eink:bg-gray-600 not-eink:text-white`) and add `eink-bordered` so e-ink renders it as `bg-base-100` + 1px `base-content` border (don't just rely on `eink-bordered`'s `!important` to override the gray — drop the gray in e-ink outright). Also fix copied white hint text (`text-white/70` → `not-eink:text-white/70 eink:text-base-content`) since the surface turns base-100. Chip icons need no change — they are `<button>`s, already inverted to base-content by the global `[data-eink] button` rule. Guard: render test asserts `.selection-popup` element carries `eink-bordered`. Verify rendered colors via `getComputedStyle` under `[data-eink]` (set `data-theme='default-light'` first or theme vars are unresolved → transparent); note daisyUI returns **oklch** not rgb — e-ink correct = bg `oklch(1 0 0)`, border/icon `oklch(0.2 0 0)`. PR #4841.

Same feature as [[customize-toolbar-global-serializeconfig]]; e-ink conventions in [[feedback_design_system_doc]].
