---
name: paginated-texture-occlusion-4399
description: Background texture absent in paginated mode (shown in scrolled) — opaque
metadata: 
  node_type: memory
  type: project
  originSessionId: 1bd8a73e-f279-4ed8-9562-98e96d9723d5
---

RESOLVED — merged. foliate-js `142bf11` (on main) + readest pointer bump/test
(`fix(reader): show background texture in paginated mode (#4399)`).

#4399: a background texture (Settings → Color → texture, e.g. Leaves) shows in
**scrolled** mode but is **absent in paginated** mode. The texture is NOT in the
iframe — it's mounted on the HOST as `.foliate-viewer::before` (`src/styles/textures.ts`,
`mountBackgroundTexture`): `position:absolute; inset:0; z-index:0; mix-blend-mode:multiply;
opacity:.6` over the reader container. For it to show, the whole foliate view tree
(iframe page bg + the paginator `#background` layer) must be transparent so the host
`::before` composites over the white page fill that a **parent** element provides
(`oklch(1 0 0)` on the reader grid cell, NOT on `.foliate-viewer`, which is transparent).

**Root cause.** foliate-js `paginator.js` `#replaceBackground`. Scrolled mode already
left things transparent under a texture (`#background.style.background = hasTexture ? '' : fallbackBg`
+ blanking transparent view elements). The **paginated** branch hard-set
`this.#background.style.background = fallbackBg` (opaque theme color, e.g. white) on the
segment **container** — that opaque container, a descendant of `.foliate-viewer`, paints
over the host `::before` texture. The per-view *segments* were already transparent for
transparent pages (`rgba(0,0,0,0)`); only the container was the occluder. Verified live
via Chrome MCP: `#background` inline bg was `rgb(255,255,255)`; setting it `''` revealed
the leaves texture instantly.

**Regression** = commit `167757a` "Fix background flash when swiping between
differently-colored pages" (2026-05-31, see [[paginator-swipe-bg-flash]]). The OLD
paginated path was a CSS `grid` of per-column divs and never set the `#background`
container background (kept the `''` reset), so a transparent page let the texture through.
167757a swapped to `computeBackgroundSegments` and added the opaque container line.

**Fix.** Extract a shared exported pure helper `textureAwareBackground(resolved, hasTexture)`
→ returns `''` when `hasTexture && isTransparent(resolved)`, else `resolved`. Use it for
BOTH scrolled view elements and paginated segment bgs, and set the paginated container
`this.#background.style.background = hasTexture ? '' : fallbackBg` (mirroring scrolled).
No-texture path unchanged → swipe-flash fix for colored pages fully preserved; a
book-forced opaque page still paints its segment (texture correctly does not show there).

Test: `src/__tests__/document/paginator-background-segments.test.ts` (new `describe` for
the pure helper, alongside `computeBackgroundSegments`). foliate-js is a submodule —
commit there + bump the pointer. See [[paginator-swipe-bg-flash]].
