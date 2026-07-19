---
name: android-system-selection-menu-one-off
description: "One-off Android system selection ActionMode (Copy/Share/Select all) appeared over the reader on Xiaomi WebView 148 (2026-07-17, unreproducible) - suppression mechanism, ruled-out triggers, and ready fix design if it recurs"
metadata: 
  node_type: memory
  type: project
  originSessionId: 353e9c4d-b3c6-4eeb-9bf1-8254615b2d3d
---

2026-07-17: user's screenshot showed the Android floating selection ActionMode (Copy/Share/Select all/overflow) over the reader alongside Readest's own toolbar, on a Xiaomi (HyperOS, Android 16, WebView 148.0.7778.217) running a local dev build (post [[captured-turn-void-promise-autoturn-revert]] fix), while manually testing the corner-dwell auto-turn. Happened ONCE; neither the user (manual) nor scripted gestures could reproduce it afterwards.

**How Readest suppresses the system menu:** no native ActionMode override exists. The only mechanism is `handleContextmenu` in `useTextSelector.ts` (preventDefault when `appService.isMobile`), attached per-section doc in `Annotator.tsx` onLoad. Verified still effective on WebView 148 for the INITIAL long-press menu.

**Ruled out on the same build+device (all clean):** plain long-press; tap-on-selection; native handle drag + release; corner drag + dwell without turn; corner drag with completed auto page-turn (selection got dropped in the synthetic run, though); double-tap. Also ruled out: CDP attachment (none at the time), instrumentation (APK hash-verified clean).

**Leading theory (unconfirmed):** Chromium ~148 re-shows the selection ActionMode when a programmatic scroll settles while a user selection is live - a state newly reachable since the corner auto-turn actually completes (pre-fix the turn was always reverted, see [[captured-turn-void-promise-autoturn-revert]]). The synthetic repro never kept the selection alive across the turn, so the trigger state was never reached.

**How to apply (ready fix design if it recurs):** native-bridge command `set_selection_menu_suppressed(bool)` toggled from `handleSelectionchange` (true while a valid selection exists in reader content docs, false when cleared), stored in a singleton the app module can read; `MainActivity.onActionModeStarted(mode)` finishes floating modes (`mode.type == TYPE_FLOATING`) while suppressed. Scoping via the JS flag keeps copy/paste menus in app text inputs working. If it recurs: capture the exact gesture sequence first, then implement + verify on WebView >= 148.
