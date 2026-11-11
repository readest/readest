---
name: chromium-selection-modify-boundary-quirks
description: "Chromium Selection.modify won't extend a forward selection back to a line/paragraph boundary, and `paragraph` steps keep the caret x; vim find (#7282) works around both"
metadata:
  node_type: memory
  type: project
  originSessionId: 247f5ff9-d0fa-4709-a948-185485ee7041
  modified: 2026-11-03T18:28:33.990Z
---

Found building vim-style find (#7281, merged #7282 + #7301, 2026-11-03), `applyVimMotion` in `src/utils/sel.ts`:

- `sel.modify('extend', 'backward', 'lineboundary' | 'paragraphboundary')` does nothing on a forward selection. Workaround: collapse to the focus, `modify('move', 'backward', …)`, then `setBaseAndExtent(anchor, newFocus)`.
- `modify(…, 'paragraph')` keeps the caret's x like a line step, landing mid-paragraph. For `}` use one `character` step then `paragraphboundary`.
- Forward `lineboundary`, `sentence` both ways, `word`, `character`, `line` behave as expected.
- `word` forward ends at the word end on macOS but past the space on Windows; `w`/`e` skip spaces to even this out. Windows WebView2 and WebKit were never checked.

**Why:** extending a selection from the keyboard (#4728 Shift+Arrows, vim find) relies on `Selection.modify`, and these fail silently.

**How to apply:** probe a new granularity in a Playwright `page.evaluate` against a real section doc (`view.renderer.getContents()`, book iframes sit in foliate's shadow DOM) before relying on it. Related: [[annotator-overlay-z-layers]].
