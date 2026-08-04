---
name: svg-cover-stretch-duokan-5375
description: "#5375 SVG-wrapped cover stretched: exact reported markup does NOT repro on Chrome; stretch only occurs via the deliberate Duokan fullscreen path (data-duokan-page-fullscreen -> preserveAspectRatio=none + object-fit:fill)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 032f04ee-bbd2-4726-9c37-47e99c910fca
  modified: 2026-08-03T16:07:01.774Z
---

Issue #5375 (2026-07-28): cover.xhtml wraps cover.jpg in `<svg viewBox="0 0 1000 1333" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">`; reporter (Windows 10, Readest 0.11.20) says the cover is stretched.

Verification on Chrome (web dev build, same code as the v0.11.20 tag for this path — only layered-turn work in paginator.js and proofread-font work in style.ts landed since):

- A minimal EPUB with the reporter's exact snippet renders CORRECTLY: inner `<image>` measured 450.1x600, ratio 0.7502 == intrinsic 1000/1333. `preserveAspectRatio` stays `xMidYMid meet`; paginator only adds max-width/max-height + `object-fit: contain` (no effect on inline svg), and `meet` letterboxes. Geometry cannot defeat `meet` — content distortion requires the attribute to be removed/`none` or a non-uniform transform.
- Adding `data-duokan-page-fullscreen="true"` to the cover.xhtml `<html>` element reproduces the symptom EXACTLY: `paginator.js` `setImageSize` `applyFullscreen` branch pins the svg absolute inset-0 100%/100%, sets `object-fit: fill !important` and rewrites `preserveAspectRatio` to `none` (paginator.js ~line 957). Measured image box 620x688, ratio 0.9012 — circle renders as ellipse. This is the intentional Duokan-native-mimicking full-page cover from the #4379 work ([[duokan-fullscreen-cover-scroll]]).

**Conclusion:** the reported markup alone is fine; the reporter's real book is almost certainly a Duokan/DangDang-flavored EPUB whose html root carries `data-duokan-page-fullscreen` (that ecosystem uses exactly this SVG cover structure). The "bug" is the feature's aspect-ratio-ignoring stretch on viewports whose aspect differs from the cover. Need the reporter's file to confirm. A fix would be scaling+cropping (cover-style) or honoring `meet` instead of `fill` in the fullscreen path — but note the stretch was chosen deliberately to match Duokan's native render.

Attribute origin found: `paginator.js` ~3303/~3391 stamps EVERY spine itemref property as `data-<prop>=""` on the content document root, so `<itemref properties="duokan-page-fullscreen"/>` in the OPF spine is the usual trigger (a literal attribute on the book's `<html>` also works since the check is `hasAttribute`). Early greps missed it because the mapping is generic (`'data-' + prop`).

**SUPERSEDED (2026-08-04):** the stretch behavior was REMOVED for #5263 — fullscreen covers now letterbox (contain + black bars), see [[duokan-fullscreen-cover-letterbox-5263]]. Historical resolution below.

**Resolution (2026-07-28):** replied on #5375 (comment 5105708791) that the stretch is the intended Duokan full-screen page behavior, aspect ratio deliberately not preserved. Reference chain: #3424 + #3914 (requests to render duokan-page-fullscreen truly full screen like Duokan Reader), #4643 (led to `object-fit: fill` instead of `contain`), #4961 (chrox: by design, no extra option, book maker's trade-off), #5263 (OPEN, same symptom; its two attached books verified to declare `duokan-page-fullscreen` on the cover itemref; also complains swipe doesn't turn pages on that page + Android-only sideways illustrations, both unverified).

Test EPUBs kept at `~/.claude/jobs/a31470c5/tmp/test-cover-5375{,-duokan}.epub`; both were imported into the localhost:3000 web dev library ("Issue 5375 SVG Cover Test" = correct, "Issue 5375 Duokan Fullscreen Test" = stretched). Import-by-JS: fetch file, `DataTransfer`, dispatch `drop` on `.library-page`.
