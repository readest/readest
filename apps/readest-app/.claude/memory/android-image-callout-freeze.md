---
name: android-image-callout-freeze
description: "Android WebView native long-press image callout collides with app touch handlers and freezes the app; reusable `.no-context-menu` fix"
metadata: 
  node_type: memory
  type: project
  originSessionId: 50bec34f-7090-4bf4-a194-9bf4029527bf
---

Recurring Android-only freeze: long-pressing an `<img>` triggers the WebView's
native image callout (context menu / drag / magnifier) which collides with the
app's own touch handlers (long-press multi-select, or pinch/pan) and freezes the
whole app until restart.

**Root cause:** `-webkit-touch-callout: none` does NOT inherit, so a
`.no-context-menu` class on a *container* never reaches descendant images.

**Fix:** the `.no-context-menu img, .no-context-menu a` rule in
`src/styles/globals.css` (sets `-webkit-touch-callout: none; -webkit-user-drag:
none; user-select: none`). Apply the `no-context-menu` class to an *ancestor* of
the image so the descendant rule reaches it. Harmless on desktop
(`-webkit-touch-callout` is a no-op there; right-click-save still works).

Occurrences so far:
- Book covers on the bookshelf — PR #4345 (`BookshelfItem.tsx`, gated on
  `appService?.isMobileApp`; added the `.no-context-menu img` rule).
- Image preview / zoom viewer — issue #4420, `ImageViewer.tsx` root container
  (applied unconditionally — no selectable text there, so no need to gate).

**How to apply:** when a new "Android freezes on long-press of an image" report
comes in, find the `<img>` and put `no-context-menu` on a containing element.
