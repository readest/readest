---
name: browser-verify-readest-web-recipe
description: "How to drive the Readest web app from Chrome MCP to verify reader fixes — read config from IndexedDB, dispatch synthetic handle drags, count overlayer groups"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 0dba721b-b7cb-42d4-8240-34a5f3afd221
  modified: 2026-08-13T07:47:47.030Z
---

Recipe for verifying reader/annotator changes in Chrome against `pnpm dev-web` (run it from
the worktree so the fix is live; `rm -rf .next` first — see [[turbopack-dev-stale-chunk-phantom]]).

**Never conclude "the dev server is wedged" from a bare `curl`.** This shell has
`http_proxy=http://127.0.0.1:8118` (and `https_proxy`) exported with no `no_proxy` for
localhost, so `curl http://localhost:3000` routes through the proxy and dies with **exit 52,
empty reply** while the server is perfectly healthy. Chrome hits the same proxy, so its tabs
can bounce to `chrome://newtab` too. Always probe with `curl --noproxy '*'` before touching
the server — a running `pnpm dev-web` may well be the user's, started in their own terminal,
and killing it costs them the process.

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

**Import a test EPUB without a file picker:** the web library has no `<input type=file>`
(native picker via button = undrivable). `useDragDropImport` listens for `drop` on
`.library-page`, so build the File in page JS (inline the epub as base64, `new File`),
put it in a `DataTransfer`, and dispatch a `DragEvent('drop', {bubbles: true})` with
`dataTransfer` defined via `Object.defineProperty`. Import runs instantly. Don't delete
the imported book afterwards if the user is signed in — library deletes can touch sync.

**A blank reader pane on a PDF in `dev-web` is almost never a bug.** Unminified pdf.js takes
**~30s per section** to render in dev: "Opening book" and the matching "doc index loaded: N" console
lines were 31s apart for a 10-page sample PDF. Every navigation into an unrendered section (Home/End,
page-jump, TOC click) shows a blank pane or the three-dot spinner for that long, and `renderer.page`
already reports the target while nothing is painted. Before diagnosing a render bug, reload with **no
keypress at all** as a baseline and grep the console for `doc index loaded` timestamps — a
"reproducible" blank that also reproduces with zero input is just latency.

**Screenshot coordinates:** the screenshot may be scaled relative to CSS pixels
(e.g. 1568x774 image for a 1280x632 viewport). Coordinates you pass back are in the same
scaled space, so reading positions off the screenshot is correct — but any coordinate you
compute in CSS px from JS must be multiplied by `screenshotWidth / innerWidth`.
