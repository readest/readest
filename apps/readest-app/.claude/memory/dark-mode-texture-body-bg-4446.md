---
name: dark-mode-texture-body-bg-4446
description: "#4446 dark-mode bg texture occluded by body.theme-dark opaque bg !important (style.ts getDarkModeLightBackgroundOverrides); verified on Xiaomi via CDP; multiview = patch ALL section iframes"
metadata: 
  node_type: memory
  type: project
  originSessionId: 61f864c0-488e-466c-89e9-86df66b57d42
---

RESOLVED — PR #4564 MERGED 2026-06-12 (`fix/dark-mode-texture-4446`, built on origin/main
via temp-index plumbing from the dirty dev tree; branch + local mods cleaned after merge).
User-verified on the Xiaomi via `pnpm dev-android` (full aarch64 build + `adb install -r`,
~7 min).

#4446 remaining case (after [[paginated-texture-occlusion-4399]] fixed light mode): in
**dark mode** the bg texture is absent in paginated entirely, and absent in the scrolled
text area while header/footer still show it.

**Root cause (verified live on Xiaomi 2211133C via CDP, no rebuild).**
`getDarkModeLightBackgroundOverrides` (style.ts ~194) emits
`body.theme-dark { background-color: ${bg} !important; }`, applied when
`isDarkMode && !overrideColor` (style.ts ~320). That paints every section iframe's body
opaque dark (`rgb(34,34,34)`), which occludes the host `.foliate-viewer::before` texture.
Downstream it also poisons foliate: `resolveBackground(view.docBackground)` resolves the
opaque body color, so `textureAwareBackground` keeps the paginated `#background` segment
and the scrolled `view.element` inline bg opaque too. The #4399 fix is intact (container
is transparent); this is a second, dark-mode-only occluder one layer deeper.

- Paginated: segment + iframe body span the full viewer → no texture anywhere.
- Scrolled: iframes cover only the text column → header/footer strips keep texture
  (grid-cell + the #4486 notch overlay, see [[notch-mask-texture-4486]]).

**Proof:** injecting `body.theme-dark{background-color:transparent !important}` into ALL
section iframes + clearing the segment/view inline bgs reveals the leaves texture in both
modes instantly.

**Regression source (git-proven):** commit `176b950c9` = PR #4392 (2026-06-01, shipped
v0.11.4) added the rule. NOT foliate-js — the foliate swipe-flash regression (#4399,
167757a→142bf11) broke LIGHT-mode textures in the same release window, which is why it
looked like one. The transformStylesheet light-bg rewriter (also #4392) was EXONERATED
for the repro book: Alice's stylesheets have zero body/html background rules (verified by
on-device stylesheet enumeration). **No #4392 revert needed** — its callout attribute
selectors + rewriter fix real legibility bugs (#4028; #4419/#4426 build on them).

**Fix (applied):** make the rule `background-color: transparent !important` —
UNCONDITIONALLY, not gated on hasBackgroundTexture, because foliate captures
`docBackground` once per section load (paginator.js `load` listener; `setStyles` re-runs
`#replaceBackground` but never re-captures), so a texture-gated body bg would go stale on
live texture toggling. Visuals without texture are identical: the dark fill comes from the
paginator container `fallbackBg` / reader grid cell. Book-forced light page bgs stay
neutralized (theme-dark fill shows through); page-level rewriter output is cascade-beaten
by our `!important` body rule and later-in-head `html` rule; only book `!important`
page rules survive — consistent with the #4399 "book-forced opaque page wins" policy.
Test: `style-get-styles.test.ts` "#4446" cases. E2E device-verified: with the fixed CSS
present at load, capture is transparent and the paginated segments array comes out EMPTY.

**Verification gotchas (cost ~30 min):**
- **Multiview!** The renderer shadow root holds MULTIPLE section iframes (adjacent preload).
  Patching `sr.querySelector('iframe')` hits a section possibly 18k px off-viewport →
  "fix didn't work". Patch every `sr.querySelectorAll('iframe')`.
- `elementsFromPoint` reports the iframe ELEMENT's computed bg (transparent) — the
  occluding paint is its content document's body, invisible to the top-doc/shadow stack walk.
- Switching `renderer.setAttribute('flow', ...)` can reload section docs and silently wipe
  styles injected into them (but not always — re-check after every flow switch).
- Pseudo-element paint test: patch the `#background-texture` style text with
  `background-color: red` — if red doesn't show, the pseudo is occluded, not broken.
- **Stale preload views**: after patching styles via `renderer.setStyles`, views loaded
  PRE-patch keep their opaque `docBackground` and `#clearViewsExcept` keeps `|i−index|≤2`
  across navigation — an opaque segment can come from a kept old view, not the fresh one.
  Jump ≥3 sections to guarantee fresh captures.
- **Capture-time instrumentation**: the paginator dispatches `load` synchronously right
  BEFORE `docBackground = getBackground(doc)` — an event listener on the renderer sees
  exactly what the capture will see (class list, computed bgs, active rules).
