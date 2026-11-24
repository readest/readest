---
name: feedback-toolbars-never-change-layout
description: "Showing/hiding the reader header/footer toolbars must never re-lay out the book content, on any device or pose"
metadata:
  node_type: memory
  type: feedback
  originSessionId: c2fae347-d5ed-44b4-95a2-8cd37de76f6b
  modified: 2026-10-30T14:48:48.586Z
---

The reader's header/footer toolbars are temporary overlays: toggling them must never change the content layout (no reflow, no column/width/margin change, no page jump).

**Why:** chrox, reviewing PR #7137 (iPhone Duo book mode) on 2026-10-30, saw the page shift on every toolbar toggle and stated this as the rule.

**How to apply:** anything sized from safe-area insets on the reading page uses the status-bar-hidden insets (`getReadingScreenInsets`), never the live ones; effects that write renderer attributes key on resolved values, not on inset objects (foliate re-renders on every attribute write, even same-value). Verify with a MutationObserver on the renderer while tapping the toolbars. Known gap: Duo inner portrait's top status strip (82pt) still moves `margin-top` 44↔126px because top/bottom stay live — pre-existing from #6312, see [[iphone-duo-6307-column-gap]].
