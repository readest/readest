---
name: ios-web-app-top-edge-blur-7887
description: "iOS 26+ Home Screen web app blurs the top edge unless an opaque fixed/sticky box covers it; #7888 fixed Library, Reader, OPDS, sign-in; /user and /hardcover/connect left unchecked"
metadata:
  node_type: memory
  type: project
  originSessionId: 574e78aa-e8fe-4e82-925f-5be5891f9544
  modified: 2026-11-25T10:10:56.303Z
---

#7887 / PR #7888 (merged 2026-11-25 as 507268083). In an installed web app on iOS 26+, WebKit draws a soft blur over the top ~100pt. It goes away only when an **opaque** fixed or sticky box covers the top edge.

- Pinning the page box to `fixed inset-0` cleared it on Library and Reader. It did **not** on OPDS (`h-screen` shell, 874pt tall vs an 812pt viewport) or the web sign-in page. What cleared those was an opaque box at the edge: OPDS header box `sticky bg-base-100`, sign-in an opaque fixed strip under Back.
- A transparent fixed element at the top (the sign-in Back button) is enough to trigger the blur.
- WebKit re-samples live after DOM style changes, so a hypothesis can be tested by mutating styles through iwdp and taking a screenshot. Confirm with a reload.
- Gate used: `appService?.appPlatform === 'web' && appService.hasSafeAreaInset`. It is true in any installed web app, including Android and desktop.
- **Not fixed:** `/user` (ProfileHeader) and `/hardcover/connect` use the same transparent `fixed z-30` header. Both need a signed-in account; a fake localStorage session gets signed out by the refresh check. No issue filed yet.
- The PR's original HeaderBar change (hidden wrapper fixed→absolute on phones) caused a mid-screen ghost toolbar in side-by-side reading, so it was reverted. Don't reintroduce it.

How to check: [[ios-sim-pwa-webclip-cli-recipe]].
