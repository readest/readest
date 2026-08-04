---
name: chrome-clipboard-paste-probe
description: Read the real system clipboard during Chrome-driven verification without triggering a clipboard-read permission prompt
metadata: 
  node_type: memory
  type: project
  originSessionId: 1fe0d4e7-c41d-496e-a9ca-e3976830677e
  modified: 2026-08-03T13:42:30.728Z
---

To confirm an in-app "copy" really wrote the system clipboard while driving the app with claude-in-chrome, do NOT call `navigator.clipboard.readText()` - it needs the clipboard-read permission and Chrome prompts for it.

Instead use a paste probe: `javascript_tool` injects a fixed-position `<input>` at the top-left, `computer left_click` focuses it, `computer key cmd+v` pastes, then `javascript_tool` reads `.value` and removes the node. This exercises the real OS clipboard end to end and stubs nothing. Used on #5452 to prove the toolbar's Copy Link output matched the sidebar's byte for byte ([[annotation-toolbar-copylink-5452]]).

Two quirks seen in that session, both pre-existing and unrelated to the change under test:
- The sidebar's annotation list painted blank until scrolled (same family as [[mobile-sheet-virtuoso-first-paint-blank]]).
- After closing the reader settings dialog, double-click word selection stopped raising the annotation popup until a drag-select was done. Observed once, NOT reproduced or filed - reproduce before treating it as real.
