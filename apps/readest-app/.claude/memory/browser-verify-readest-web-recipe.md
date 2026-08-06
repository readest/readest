---
name: browser-verify-readest-web-recipe
description: "How to drive the Readest web app from Chrome MCP to verify reader fixes — read config from IndexedDB, dispatch synthetic handle drags, count overlayer groups"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 0dba721b-b7cb-42d4-8240-34a5f3afd221
  modified: 2026-08-06T14:17:54.585Z
---

Recipe for verifying reader/annotator changes in Chrome against `pnpm dev-web` (run it from
the worktree so the fix is live; `rm -rf .next` first — see [[turbopack-dev-stale-chunk-phantom]]).

**Read the persisted book config** (web app stores files in IndexedDB, not localStorage):
db `AppFileSystem`, store `files`, key `Readest/Books/<bookHash>/config.json`. Value may be a
string, Blob, ArrayBuffer, or `{content}` — normalize before `JSON.parse`. This is the ground
truth for whether a booknote was duplicated vs updated in place.

**Reach the reader internals:** everything lives in shadow DOM. Walk `el.shadowRoot`
recursively to find `FOLIATE-VIEW` and the content iframe; there are no iframes in the top
document. `fv.renderer.getContents()[0].overlayer.element` holds one `<g>` per drawn overlay —
counting those catches orphaned overlays that overlap visually and are invisible in screenshots.

**Drag the annotation range handles:** real `left_click_drag` from the extension misses them —
the drag turns into a text selection. Dispatch `PointerEvent`s directly on the handle's
`<circle>` instead (`pointerdown` → several `pointermove` with ~60ms gaps → `pointerup`), and
no-op `Element.prototype.setPointerCapture`/`releasePointerCapture` first, or the synthetic
pointerId throws and `handlePointerUp` never reaches `onDragEnd`. The handles are
`position: fixed` divs in the TOP document: find the container by
`pointer-events-none` + `inset-0` with exactly 2 children that each contain `svg circle`.

**Opening the annotation popup** does need a real extension click on the highlight (foliate
listens for `click` on the iframe document, so synthetic clicks on the top document just turn
the page). Verify it fired by listening for `show-annotation` on the foliate-view element.

**Screenshot coordinates:** the screenshot may be scaled relative to CSS pixels
(e.g. 1568x774 image for a 1280x632 viewport). Coordinates you pass back are in the same
scaled space, so reading positions off the screenshot is correct — but any coordinate you
compute in CSS px from JS must be multiplied by `screenshotWidth / innerWidth`.
