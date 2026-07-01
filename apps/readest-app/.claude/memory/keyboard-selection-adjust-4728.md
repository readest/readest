---
name: keyboard-selection-adjust-4728
description: "After a reader text selection, keystrokes land in the PARENT (container focus), not the iframe — fix Shift/Ctrl/Alt+Arrow selection refine in useBookShortcuts"
metadata: 
  node_type: memory
  type: project
  originSessionId: 9ebaeccc-0436-4c7b-a81e-1a4aa3de64dd
---

#4728: standard desktop selection shortcuts — `Shift+←/→` refine selection by character, `Ctrl/Alt(Option)+Shift+←/→` by word — implemented in the **parent** shortcut system, not the iframe.

**Critical gotcha (cost a full redesign):** after a text selection, `Annotator.handleShowAnnotPopup` calls `containerRef.current?.focus()` on desktop, so `document.activeElement` is a **parent-document DIV**, not the book iframe. Real OS keystrokes therefore go to the parent `window` → `useShortcuts` (native keydown path) → page-turn shortcuts (`shift+ArrowRight`=`onGoNext`/`onGoForward`). A fix inside the iframe `handleKeydown` is **bypassed** for real keystrokes — it only fires if focus is in the iframe (e.g. quick-actions config). JS-dispatched `KeyboardEvent`s into the iframe doc DO hit the iframe handler, so they falsely "pass" — only a **real OS key** (`computer.key`) reveals the parent-focus path. Always verify with a real keystroke, not a synthetic dispatch.

**Fix shape:**
- `utils/sel.ts`: pure `getKeyboardSelectionAdjustment(KeyModifiers)` → `{direction:'left'|'right', granularity:'character'|'word'}|null` (Shift=char, Ctrl||Alt=word, metaKey→null so native Cmd+Shift line-select survives; 'left'/'right' visual dir for RTL). `extendSelectionFromContents(contents, ev, extend)` walks `view.renderer.getContents()` (`{doc}[]`), finds the non-collapsed `doc.defaultView.getSelection()`, and (if `extend`) `sel.modify('extend', dir, gran)`; returns whether a selection was found.
- `helpers/shortcuts.ts`: new `onAdjustTextSelection` (section 'Selection') with keys `shift+Arrow{Left,Right}` + `ctrl/alt+shift+Arrow{...}`.
- `useBookShortcuts.ts`: `adjustTextSelection` wired **first** in the `useShortcuts` actions map so it intercepts before `onGoNext/Prev/...`. Native keydown (parent focus) → extend ourselves; forwarded iframe-keydown MessageEvent (iframe already extended natively) → `extend:false`, just report presence to suppress nav. Returns true ⇒ `processKeyEvent` stops ⇒ no page turn.
- `useTextSelector.handleSelectionchange`: desktop normally defers to pointerup; relaxed the gate to `!isAndroid && !isTouchInput && isPointerDown.current` (new `isPointerDown` ref set in pointerdown, cleared in pointerup/cancel) so a keyboard-driven `selectionchange` (no pointer drag) refreshes the popup/range. This realm-agnostic gate refreshes for BOTH the parent-modify and native-iframe-modify paths.

**Selection.modify test artifact:** in browser-lane tests build the starting selection with `setBaseAndExtent` (or collapse+extend), NOT `addRange` — `addRange` leaves the selection directionless so backward `modify('extend','left'/'backward')` silently no-ops; `setBaseAndExtent` establishes anchor/focus like a real mouse drag.

Verified live on Chrome with real keystrokes (Alice EPUB, scrolled mode): `Shift+→` "Queen"→"Queen." no turn; `Opt+Shift+→` "two"→"two miles" (word); popup follows; no selection ⇒ `Shift+→` still scrolls (nav preserved). Paginated auto-scroll-to-follow when extending past the page edge is NOT wired (foliate's `isKeyboardSelecting` scrollToAnchor only fires for iframe-focus keydowns; parent-focus has none) — minor known limitation. See [[layout-ui-fixes]].
