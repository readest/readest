---
name: opds-http-cover-mixed-content-6637
description: "#6637 iOS OPDS covers missing over Tailscale = WebKit mixed-content block of http <img> on tauri:// origin; LNA exempts only \"local\" hosts; MERGED #6639 (9221305a1) UNRELEASED"
metadata:
  node_type: memory
  type: project
  originSessionId: 2d48572b-3699-43a0-a661-9f2eb63efe16
  modified: 2026-10-04T18:52:58.683Z
---

#6637 (2026-10-05): iOS 27 OPDS covers never requested over Tailscale (100.x / MagicDNS), fine on 192.168 LAN; macOS fine.

Root cause: unauthenticated catalogs put the raw `http:` cover URL into `<img>`; the app origin `tauri://localhost` is secure, so it is mixed content. WebKit `MixedContentChecker::shouldBlockRequest` skips the block only when `effectiveTargetAddressSpace` != Public (Local Network Access, WebKit 320538@main). 100.64/10 only became Local in 319918@main (Aug 2026); hostnames are ALWAYS Public. Blocked before any network request, which is why the server logs show feeds (native reqwest) but no /cover.

Fix: `needsNativeImageFetch(url)` (Tauri + `http:`) in `opdsReq.ts` routes covers through the existing auth-catalog `downloadFile` → Cache → `getImageURL` path in `opds/page.tsx`. MERGED #6639 (9221305a1) UNRELEASED, not device-verified (no iOS 27 sim runtime here).

**Why:** any `http:` resource rendered by the WKWebView on iOS/macOS can hit this, not just OPDS covers.
**How to apply:** for "http image/resource loads on LAN but not VPN/hostname on Apple" reports, check whether the webview loads it directly; fetch natively instead. WebKit source: gh api repos/WebKit/WebKit contents Source/WebCore/loader/MixedContentChecker.cpp + Modules/fetch/IPAddressSpace.cpp.
