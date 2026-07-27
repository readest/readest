---
name: paragraph-mode-styling-5275
description: "#5275 paragraph mode chrome aligned to the TTS mini player (MERGED #5338); overlay must be solid, and hoveredBookKey silently hides the bar during QA"
metadata: 
  node_type: memory
  type: project
  originSessionId: b5f06fe3-6cc2-41ec-b8f5-0652c2fe9e11
  modified: 2026-07-26T08:22:24.422Z
---

#5275 (2026-07-26, MERGED as PR #5338 → `d1ab15c0f` on main; worktree and branch cleaned up): paragraph
mode's bottom bar and overlay were restyled to match the TTS mini player — the bar now reuses the
player's card (`not-eink:bg-base-300 eink-bordered rounded-2xl shadow-lg`, `h-14`, plain
`shrink-0 rounded-full p-1` glyph buttons at 26/20px), one text run for the position, and a plain
opacity fade instead of slide + scale + blur.

Two things that are not obvious from the diff:

- **The overlay backdrop has to be fully opaque.** It used
  `oklch(var(--b1) / 0.92)` + `backdrop-filter: blur(20px)`. Dropping only the blur leaves book text
  ghosting through the 8% gap, so the backdrop became `bg-base-100`. That also made the paragraph
  frame's `oklch(var(--b1) / 0.14)` tint and its `rounded-[2rem]` dead code (same color over same
  color), and the `dimOpacity` prop unused — all removed.
- **`hoveredBookKey === bookKey` hides ParagraphBar entirely** (`isHiddenByHover`). During manual QA,
  hovering the reader's header/footer once leaves that key set, and after that the bar never appears
  no matter how many taps or `paragraph-show-controls` events fire — it looks like a broken fix. To
  screenshot the bar, either avoid touching the top/bottom edges first, or force
  `classList.remove('opacity-0','pointer-events-none')` on `div.fixed.z-50` from the console.

Related: [[paragraph-mode-toggle-resume-4717]], [[paragraph-mode-accidental-exit-4474]],
[[feedback_design_system_doc]].
