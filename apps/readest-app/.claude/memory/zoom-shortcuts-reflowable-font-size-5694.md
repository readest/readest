---
name: zoom-shortcuts-reflowable-font-size-5694
description: "#5694 zoom shortcuts on EPUB/MOBI step defaultFontSize; MERGED #6067; skipGlobal persists per-book, zoomLevel must stay 100, CDP cannot type shift+="
metadata: 
  node_type: memory
  type: project
  originSessionId: 522cae50-17b2-4642-ae95-5e7df7d8b958
  modified: 2026-09-05T12:43:49.450Z
---

Issue #5694: `Ctrl/Cmd +/-/0` were dead keys on reflowable books (they only
drove `scale-factor`, which only fixed-layout documents have). Fixed by
stepping the book's own `defaultFontSize` in `useBookShortcuts.ts`.
MERGED 2026-09-05 as #6067 (dd9a8daa3).

**Load-bearing facts, in the order they bite:**

- `zoomLevel` MUST stay 100 for reflowable documents. `style.ts` computes
  `defaultFontSize * fontScale * (zoomLevel/100)`, so writing zoomLevel there
  double-scales the text. `applyZoomLevel` already guards on `isFixedLayout`;
  the font path is a separate branch, not a reuse of it.
- `saveViewSettings(..., skipGlobal=true)` really is per-book and really does
  survive a reload, even when the book's scope is still `isGlobal: true`.
  Reason: `serializeConfig` persists only the fields that DIFFER from
  `globalViewSettings`, and `initViewState` rehydrates as
  `{...globalViewSettings, ...configViewSettings}` — config wins. So there is
  no need to flip `isGlobal` to make a per-book override stick, and flipping it
  would be wrong (it is the user's Settings-scope choice, see [[settings-scope-menu-5933]]).
- `Ctrl`+wheel over a reflowable book now resizes text too, because
  `useIframeEvents` dispatches the same `zoom-in`/`zoom-out` events with
  `factor = |deltaY|/100`. Trackpad pinch deltas are small, so `Math.round`
  makes a slow pinch a no-op — same as the old behavior (nothing happened),
  not a regression. A normal wheel (deltaY >= 100) steps 1px.

**Verifying reader shortcuts in Chrome (the trap):**

The claude-in-chrome extension's synthetic `shift+=` arrives in the page as
`key: "="` with `shiftKey: true`, NOT `key: "+"`. `parseShortcut` maps the
authored `shift+=` to the key name `plus`, so the binding never matches and
the shortcut looks broken when it is not. `ctrl+=` / `ctrl+-` / `ctrl+0` are
rejected outright by the `computer` tool as browser page-zoom keys.

Workaround that exercises the REAL handler chain (iframe keydown -> the
app's `iframe-keydown` bridge -> `useShortcuts`): dispatch the event inside
the section iframe with `javascript_tool`.

```js
// the section iframes are behind nested shadow roots; document.querySelectorAll
// ('iframe') returns NOTHING. Walk the shadow trees:
const found = [];
const walk = (root, d) => { if (d > 6) return; for (const el of root.querySelectorAll('*')) {
  if (el.tagName === 'IFRAME') found.push(el); if (el.shadowRoot) walk(el.shadowRoot, d + 1); } };
walk(document, 0);
const doc = found[0].contentDocument;
doc.body.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown',
  { key: '=', code: 'Equal', ctrlKey: true, bubbles: true, composed: true, cancelable: true }));
// read back: getComputedStyle(f.contentDocument.body).fontSize
```

Fixed-layout zoom reads back as
`document.querySelector('foliate-view').renderer.getAttribute('scale-factor')`.
To restore an exact fractional scale-factor you changed while testing, post the
wheel message instead of pressing keys (bookKey comes from the
`gridcell-<hash>-<uid>` element id):

```js
window.postMessage({ type: 'iframe-wheel', bookKey, ctrlKey: true,
  deltaY: (100 - target) * 10, deltaX: 0, deltaMode: 0 }, '*');
```

Related: [[feedback_use_worktree]], [[feedback_pr_new_branch]].
