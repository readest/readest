---
name: footnote-popup-revokes-section-blobs
description: "Opening a footnote popup twice on a footnote in the CURRENT section revokes that section's image blob URLs — illustrations stay painted but stop opening; root cause is Loader.ref()'s undefined-parent bucket in foliate-js epub.js"
metadata: 
  node_type: memory
  type: project
  originSessionId: 01ca940a-48c4-4ae3-b29b-1877939ed069
  modified: 2026-08-17T07:39:50.919Z
---

Reported (zh): reading a novel with both footnotes and illustrations, tapping footnote content
3+ times makes illustrations un-openable until the reader is closed and reopened.
VERIFIED in Chrome 2026-08-17 against `pnpm dev-web`, foliate-js `9fde61a1`.
FIXED 2026-08-17: foliate#78 MERGED as `c1f0c3c`, readest#5756 MERGED as `a193cbc3`. Device
verify pending.

**Root cause — `Loader.ref()` in `packages/foliate-js/epub.js:887`.** `#children` is keyed by
`parent`, and top-level section loads pass `parent === undefined`, so ALL top-level refs share one
`#children.get(undefined)` bucket. Once an href is in that bucket the `!childList?.includes(href)`
guard makes every later `ref()` a **no-op** — while every `unloadItem` still calls `unref()` and
decrements. Nothing ever calls `unref(undefined)`, so the bucket is never cleaned. The refcount
underflows and `unref` revokes the section's blob URL **and recursively all its children (images)**
while the main view is still displaying them.

`createURL` skips the children bucket when `parent` is undefined, which is why the FIRST popup
increments correctly and only the second one underflows.

**Exact measured cycle** (popup on a footnote whose target is in the displayed section):
- open#1 `ref` 1→2 (creates `children[undefined]=[S]`), close#1 2→1 — image still alive
- open#2 **skipped** (bucket already has S), close#2 1→0 → **REVOKE S + all child blobs**
- every later close revokes again (2 URLs per close: section XHTML + image)

So it breaks on the **2nd dismissal**, consistent with the user's "3+ taps".

**Why it looks like "images broke but the page is fine":** an `<img>` already decoded stays painted
after its blob URL is revoked (`complete:true`, `naturalWidth:1502`). Only a NEW fetch fails, so
`handleImagePress` → `convertBlobUrlToDataUrl` → `TypeError: Failed to fetch` → `console.error`
and the viewer never opens. Chain: `Paginator.destroy()` → `#destroyAllViews()` →
`sections[i].unload()` → `Loader.unref()`.

**The fix needs TWO halves; the first alone LEAKS.** (1) in `ref()`, when `parent` is absent always
increment and skip the childList dedup. (2) `loadItemXHTMLContent` must NOT take a reference:
`Paginator` calls `section.load()` AND `section.loadContent()` per view (paginator.js:3490, :3718)
against a single `unload()`, and the buggy shared bucket had been absorbing that second call. Fix
`ref()` alone and every section the reader ever opened is retained forever. These are the only two
top-level `loadItem` callers; `loadHref`/`replaceString` always pass a non-empty `parents`.

**Verification recipe** (no library writes; user is signed in, so do NOT import a test book):
open any EPUB, inject `<a epub:type="noteref" href="<ownFileName>#id">` + a matching target into
the live section doc, click it with a synthetic `MouseEvent` on the anchor (see
[[browser-verify-readest-web-recipe]]), dismiss with the app's own
`document.querySelector('.footnote-content foliate-view')` → `.close(); .remove()`, and probe
`fetch(imgUrl)` between cycles. Tap-to-open is reproducible by posting
`{type:'iframe-open-media', bookKey, elementType:'image', src}` — exactly what
`iframeEventHandlers.ts:530` posts.

Related: [[footnote-popup-selection-5646]], [[loaddocument-xhtml-parsererror-5625]].
