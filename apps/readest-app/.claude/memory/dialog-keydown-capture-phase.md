---
name: dialog-keydown-capture-phase
description: "Dialog.tsx stops every keydown at its own node, so a React onKeyDown on anything inside a Dialog never fires in the real app; use onKeyDownCapture. jsdom tests pass anyway"
metadata:
  type: project
---

`src/components/Dialog.tsx` adds a native `keydown` listener on the dialog node that calls `event.stopPropagation()` on every key (from #983 Android Back, #2050 screen readers). Next's App Router mounts React on `document`, so React's delegated bubble listener never sees keys pressed inside a Dialog: arrow-key handlers in #6986's stats chart and heatmap did nothing in Chrome and Tauri while their component tests passed.

**Why:** jsdom tests render the component without the Dialog, so the stop never happens there.

**How to apply:** bind key handlers inside a Dialog with `onKeyDownCapture` (React's capture listener on `document` runs before the dialog's bubble listener). Cover it in tests by wrapping the component in a div whose ref adds `keydown` → `stopPropagation()`. Other `onKeyDown` users under Dialog (settings forms etc.) may be silently broken: unaudited.
