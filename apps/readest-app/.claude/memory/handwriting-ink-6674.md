---
name: handwriting-ink-6674
description: "Handwriting/drawing MERGED #6674 (7893fa916, 2026-10-11); prod migration 026 + i18n + BOOX pen-device verify still OPEN; iOS Pencil lessons"
metadata:
  node_type: memory
  type: project
  originSessionId: cb51df53-15ef-424f-9bd4-07f9f549b5d5
  modified: 2026-10-11T20:09:08.202Z
---

PR #6674 (BOOX handwriting, contributor fork, reworked by us) MERGED 2026-10-11 as 7893fa916.

**Design the user settled on:**
- **Entry:** "Instant Draw" lives in the header's instant annotation tools.
- **Dock (bottom only):** Pen, Marker, Eraser, Undo, Redo, page arrows, Save, Close.
  - Save ends the session = one ink annotation, and stays in drawing mode.
  - Close exits. Every stroke is autosaved as it is drawn.
- **Pinning:** reflowable ink pins to a text CFI and morphs by shape (flow/box/span/rigid). Fixed-layout ink pins to the page.
- **Sidebar:** each ink annotation is a sidebar item; items lead with a kind badge (bookmark/highlight/note/drawing).

**Still OPEN:**
1. Run migration `docker/volumes/db/migrations/026_add_book_notes_ink.sql` (`ink jsonb`) on Readest Cloud
   BEFORE the web deploy; a server without the column fails any notes upsert containing a drawing.
2. Translations: Instant Draw, Pen, Marker, Eraser, Save, Close, Drawing, Drawing saved.
3. The BOOX raw-drawing path is unverified on a pen-capable BOOX (see [[boox-pen-sdk-build-gotchas]]).

**iOS Pencil lessons (iPad Air M2, iPadOS 27):**
- `touch-action: none` is not enough. WebKit read tap-then-quick-stroke as its own double-tap/selection
  gesture and delivered ZERO events for the stroke. The fix is preventDefault on touchstart/touchmove
  (passive:false) plus user-select/touch-callout none.
- Diagnose such cases by logging to the Tauri log file and pulling it with
  `xcrun devicectl device copy from --domain-type appDataContainer` (Library/Application Support/<id>/logs/Readest.log).
- Device screenshots: Xcode Devices window "Take Screenshot". idevicescreenshot is dead on iOS 17+.

**Ink sync guarantees:**
- Ink notes are pushed without an xpointer, so every koplugin version skips them (the plugin
  imports ANY note with an xpointer as a highlight).
- A pulled row without strokes must carry no `ink` key: the merge spreads incoming over local.

See [[ios-worktree-device-build-gotchas]].
