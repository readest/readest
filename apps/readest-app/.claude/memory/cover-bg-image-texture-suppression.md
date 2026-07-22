---
name: cover-bg-image-texture-suppression
description: Cover painted via body background-image vanished under an active bg texture (parchment) because textureAwareBackground misclassified it as transparent
metadata: 
  node_type: memory
  type: project
  originSessionId: 9d32520c-53be-4871-9104-d93617736e30
---

EPUB cover pages that paint the cover via a `<body>` CSS `background-image`
(EPUB sets `background-color` transparent + `background-size:100% 100%`, no
`<img>` — e.g. Sigil/duokan样书《商梯》) showed the **background texture instead
of the cover** on the first page. Reported "Xiaomi only" but it's
texture-only, not Android-only.

Root cause (verified on-device via adb+CDP, Xiaomi 13 WV147): foliate
`packages/foliate-js/paginator.js` `textureAwareBackground(resolved, hasTexture)`.
foliate captures the body bg into `view.docBackground` via
`getComputedStyle(body).background` (the SHORTHAND), which always serializes the
transparent background-*color* first: `rgba(0, 0, 0, 0) url("blob:…") no-repeat
fixed 50% 50% / 100% 100% …`. The old `isTransparent` regex
`/^\s*(transparent|rgba\(0,\s*0,\s*0,\s*0\))/` matched that prefix → under an
active texture (`--bg-texture-id` != none) it returned `''` → no bg segment in
the host `#background` → texture (`.foliate-viewer::before`) showed through. With
no texture it worked (returns the cover bg unchanged), which is why desktop/
default looked fine.

Fix: a bg that carries an image is NOT transparent. Add `hasImage =
/\burl\(/i.test(resolved)` and gate `isTransparent` on `!hasImage`. A full-page
cover should occlude the texture; plain `none` transparent pages still drop so
the texture shows through. Helps scrolled (line ~1464) and paginated (~1482)
callers alike. Test: `paginator-background-segments.test.ts` (added the
url()-keeps case; kept the existing `none`-drops case).

NOT the bug (ruled out on-device): Rust `parse_epub_metadata` cover EXTRACTION
(library thumbnail was correct), shorthand serialization (WV147 emits the url
fine), the cover blob URL (loads 1200x1800 fine), `background-attachment:fixed`
(Android falls back to scroll but the segment sets `background-attachment:
initial` anyway). Related: [[paginated-texture-occlusion-4399]],
[[dark-mode-texture-body-bg-4446]], [[paginator-swipe-bg-flash]].

CDP verify recipe: pid changes per app restart — re-derive socket from
`/proc/net/unix` (`webview_devtools_remote_<pid>`), `adb forward tcp:9333
localabstract:…`; curl mishandles WV HTTP framing → raw-socket fetch `/json`;
pure-python WS client (omit Origin for M111+); paint a 50%-width test segment
with the cover blob bg into `#background` + `Page.captureScreenshot` to see
cover-vs-texture side by side.
