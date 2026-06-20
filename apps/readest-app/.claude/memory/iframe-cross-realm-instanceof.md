---
name: iframe-cross-realm-instanceof
description: "App-bundle code handling foliate iframe DOM must not use `instanceof Element/HTMLElement` — cross-realm, always false"
metadata: 
  node_type: memory
  type: project
  originSessionId: 2e8d274e-a4da-4d63-8afb-d7a600d560b2
---

Reader content lives in foliate iframes, each with its **own JS realm**. App-bundle
code (e.g. `src/utils/style.ts`, `iframeEventHandlers.ts`) runs in the **top window
realm**, so its `Element`/`HTMLElement` constructors differ from the iframe's.

`someIframeEl instanceof Element` (top-realm `Element`) is **always `false`** — verified:
`Element === iframeWin.Element` is false. So any guard like `if (!(target instanceof Element)) return`
silently drops every real iframe element. Functions still pass jsdom unit tests (single realm)
yet are dead in the running app.

**Use duck-typing instead**: `if (!target || !('closest' in target)) return;` then
`(target as Element).closest(...)`. For node-type checks use `node.nodeType === Node.ELEMENT_NODE`
(numeric constant, realm-safe) or check `classList`/`closest` presence.

Seen in PR #4391 (wide-table horizontal scroll): the touch `findWrapper` and `applyTableStyle`'s
re-entrancy guard both used `instanceof`, so the touch routing never fired and the dedupe guard
never tripped. Related: [[foliate-touch-listener-capture-phase]].
