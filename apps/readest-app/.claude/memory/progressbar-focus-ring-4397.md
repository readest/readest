---
name: progressbar-focus-ring-4397
description: ProgressBar footer painted a stray focus-ring line on Android long-press; fix = remove tabIndex from the decorative div
metadata: 
  node_type: memory
  type: project
  originSessionId: 7d650c44-2d60-4a88-a9f5-6b5956bca59b
---

#4397 "Strange line on the bottom of the page when long-pressing the footer" (Android 13, 0.11.2).

**Symptom:** a thin horizontal line, content-column wide, across the last text line / bottom margin. Appears after long-pressing the footer + turning a page; persists across page turns; cleared by double-tapping the footer + turning a page. Maintainer couldn't repro on eink (device/WebView-specific long-press focus behavior).

**Root cause:** `ProgressBar.tsx` (the always-on page-info footer, `.progressinfo`) rendered as `<div role='presentation' tabIndex={-1} onClick=...>`. The `tabIndex={-1}` made the decorative div click/touch-focusable. Android WebView long-press focused it and painted the browser default focus ring (`outline: auto`, matched `:focus-visible`). It's a top-document element pinned `absolute bottom-0` at book-view width, so the ring shows as a content-width box at the bottom on *every* page until focus clears. NOT a range/slider input — those are `opacity-0`/`visibility:hidden` (red herring: globals.css excludes `input[type='range']` from its outline-suppression rule, but that's unrelated here).

**Fix:** remove `tabIndex={-1}`. A `role='presentation'` decorative element must not be focusable. `onClick` (tap-to-cycle progress mode / dismiss annotation popup) fires regardless of tabindex, and no ancestor has a real `tabindex` to grab focus instead (verified: focus falls through to `<body>`). Nothing programmatically focuses `.progressinfo`. Test asserts `.progressinfo` has no `tabindex` attribute (in `ProgressBar.test.tsx`).

**Debugging technique that worked:** download the issue video (`gh` attachment URL) → `ffmpeg` extract frames → zoom on the line; the **downward corner at the right end** revealed it was a rectangular *outline* (focus box), not a strikethrough/selection. Then in the live dev app (`mcp__claude-in-chrome__javascript_tool`): `el.focus(); el.matches(':focus-visible'); getComputedStyle(el).outlineStyle` → returned `true` / `auto`, confirming the element + mechanism. See [[annotator-reader-fixes]] [[layout-ui-fixes]].
