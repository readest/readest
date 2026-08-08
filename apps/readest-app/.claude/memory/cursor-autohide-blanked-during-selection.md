---
name: cursor-autohide-blanked-during-selection
description: "autohideCursor hid the pointer mid text selection; the guard belongs in CursorAutohider.hide(), not at arm time, because double-click select fires no mousemove"
metadata: 
  node_type: memory
  type: project
  originSessionId: baccdf36-54f1-4398-92a0-80a42087d950
  modified: 2026-08-07T14:36:02.217Z
---

Auto-hide cursor blanked the pointer in the middle of a text selection. foliate-js `CursorAutohider` (`packages/foliate-js/view.js`) decided purely on mousemove idleness (1s) and had no notion of an active selection. Two symptoms: a **paused selection drag** (hold, stop to think where to end it, cursor vanishes while you are still aiming), and a **double-click word select**, which fires *no* mousemove at all so the already armed timer simply ran on a brand new selection.

MERGED readest/foliate-js#68 (squash `f65836f`) + readest#5557 (`b1bafcaf4`, 2026-08-07). Verified by unit tests only — never driven against a real book in a running app, so a Chrome pass on a paused drag and a double-click select is still outstanding.

**Why:** the fix is a 6-line guard, but *where* it goes is the whole trick. Putting it at arm time (`if (check())` in the mousemove listener) only covers selections that already exist when the timer is set, so the double-click case still hides. Guarding inside `hide()` covers both: selection made after arming, and timer re-armed while a selection stands.

**How to apply:**
- Guard is `!ownerDocument.getSelection().isCollapsed`. `ownerDocument` is the correct scope for *both* instances: the top document for the host `<foliate-view>`, and the section's iframe document for the per-section clone made in `#onLoad` via `cloneFor(doc.documentElement)` — which is where reader selections actually live. Do not reach for the top-level `document`.
- No stuck-visible state, because any click collapses the selection and the next mousemove re-arms. Consuming actions (copy/share/search/TTS/highlight) deselect; lookup popups deliberately keep the selection live while open (`Annotator.tsx` ~1939), so the cursor now stays visible while you aim at one — intended.
- `src/__tests__/reader/autohide-cursor.test.ts` already existed and drives the real class through the real custom element (jsdom, fake timers) — extend it rather than mocking. Selection is set up with a real `Range` on `document.body`; remember to `removeAllRanges()` in `afterEach` or the state leaks into sibling tests.
- Autohide is desktop-only (`!appService?.isMobile`, `FoliateViewer.tsx`), so no mobile impact.

Related: [[worktree-submodule-origin-is-local-gitdir]], [[ci-pr-delivery-and-push]].
