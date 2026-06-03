---
name: duokan-fullscreen-cover-scroll
description: "Duokan fullscreen cover image invisible in scrolled mode (#4379) — paginator pins it position:absolute height:100% which collapses against auto-height scroll container"
metadata: 
  node_type: memory
  type: project
  originSessionId: c45aabf0-e8a3-42b6-a5fd-c04d6eb2345c
---

Issue #4379: an EPUB cover with `data-duokan-page-fullscreen` on `<html>` (Duokan/DangDang convention) shows in paginated mode but is **blank in scrolled mode**; only the first cover image, other images fine in both modes.

**Root cause** — `View.setImageSize()` in `packages/foliate-js/paginator.js` has a `pageFullscreen` branch that pins each img with `position:absolute; inset:0; width:100%; height:100%` and forces ancestors + `<html>` to `height:100%`/`position:relative`. This fills the page in paginated/columnized mode (html has a fixed pixel height). In scrolled mode `scrolled()` sets `html`/`body` height to `auto`, so the `height:100%` chain resolves to **0** and the absolutely-positioned cover collapses out of view (offsetHeight 0).

**Fix** — gate the fullscreen treatment on column mode: `const applyFullscreen = pageFullscreen && this.#column`. Use `applyFullscreen` for the max-height/max-width margin term and the `if` block. Add an `else if (pageFullscreen)` that `removeProperty`s the stale `position/inset/width/height/margin` on the img (and `width/height/margin/padding` on ancestors, `position` on html) so toggling paginated→scrolled doesn't leave the cover collapsed (same iframe/img is reused via `view.render(layout)` on `flow` change). In scrolled mode the cover then flows like a normal full-page image bounded by `max-height = availableHeight`.

**Key facts**
- `this.#column = layout.flow !== 'scrolled'` (set in `render()` before `setImageSize`), so it's reliable inside `setImageSize`.
- Foliate writes these styles as **inline `!important`** → cannot be overridden from `src/utils/style.ts`; the fix must live in the paginator.
- Regression test: `src/__tests__/document/paginator-duokan-cover.browser.test.ts` + fixture `repro-4379.epub` (cover xhtml with the duokan attr + dimensionless `<img>`). Asserts cover `img.offsetHeight > 0` in scrolled mode, paginated sanity, and paginated→scrolled toggle. Browser test (real layout) is required — jsdom can't compute the collapse.

Related: [[paginator-swipe-bg-flash]], [[css-style-fixes]].
