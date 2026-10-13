---
name: ios16-color-mix-currentcolor-crash-6355
description: "#6355 MERGED #6497; iOS 16 Settings/proofread reload to library = WebKit <17 crashes on color-mix(currentColor) winning box-shadow/color; daisyUI 5 toggle + range thumb; fix in globals.css; iOS min is 16.4 since #5884"
metadata:
  node_type: memory
  type: project
  originSessionId: 369bad4d-88b1-42a5-9370-99efa401f662
  modified: 2026-09-30T10:44:10.384Z
---

#6355 (iOS 16.5, 0.12.6+): opening Settings or the proofread popup reloads the webview to the library. Cause is a WebContent crash: WebKit before Safari 17 dies when a `color-mix()` that takes `currentColor` WINS `box-shadow`, `color`, `::placeholder` color or a `::-webkit-slider-thumb` box-shadow. `background-color` and custom properties survive. daisyUI 5 (5.7.22, still present in 5.7.47, so upgrading does NOT help) uses it in `.toggle`, `.toggle:before` and `.range` thumb. Tailwind preflight guards its own placeholder rule with `@supports (not (-webkit-appearance:-apple-pay-button)) or (contain-intrinsic-size:1px)`.

Fix MERGED #6497 (ec556de87) 2026-09-30, UNRELEASED; upstream daisyUI#3861 (same bug, macOS 13.4) closed NOT_PLANNED by owner, so keep the override: `@layer utilities` overrides drop those shadow layers. They are invisible because themes pin `--depth: 0`. Test: `currentcolor-color-mix-shadow.browser.test.tsx`. Verified on the iOS 16.4 sim: pre-fix app CSS crashes in Safari, fixed CSS survives, and the real app opens Settings. The proofread popup was not walked (needs a book).

**Why:** the daisyUI 5 migration #5884 also raised iOS `minimumSystemVersion` to 16.4. iOS 15 devices can't install 0.12.6+ at all, so chrox skipped iOS 15.8 verification.

**How to apply:** an iOS 16 sim runtime can be fetched with `xcodebuild -downloadPlatform iOS -buildVersion 16.4` (6 GB). The first `simctl openurl` often times out. Detect crashes with a page that `fetch('/alive')`s after 2s and grep the http.server log. Safari shows "This webpage was reloaded because a problem occurred". Related: [[ios16-fonts-ready-webcontent-crash]], [[daisyui-v5-tailwind-v4-migration]].
