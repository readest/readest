---
name: ios16-safari-layout-repro-old-webkit
description: "Reproduce iOS 16 Safari layout bugs on macOS 27 with Playwright 1.33's WebKit 16.4 build (iOS 16.4 sim runtime is unsupported); #7181 plan cards clipped by h-full on grid items"
metadata:
  node_type: memory
  type: reference
  originSessionId: 37dc159a-99b4-481f-b884-5ae003fcab0c
  modified: 2026-10-31T15:02:45.045Z
---

The iOS 16.4 simulator runtime won't run on macOS 27 ("not supported on hosts after macOS 26.99.99"). To reproduce iOS 16 **layout** bugs, use an old Playwright WebKit build instead (2026-10-31, #7181, PR #7184 MERGED 584a4e18f, UNRELEASED, not device-verified on iOS 16):

- In a scratch dir: `npm i --no-save playwright-core@1.33.0` (not `playwright`: its postinstall downloads every browser and is slow through the proxy), then `PLAYWRIGHT_BROWSERS_PATH=$PWD/browsers PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=mac13-arm64 node node_modules/playwright-core/cli.js install webkit` downloads "Webkit 16.4 (build v1837)". It runs on macOS 27. Pass the same two env vars when launching it.
- Page: render the component with `renderToStaticMarkup` in a throwaway vitest file (mock useTranslation), wrap it in the page's real chassis (flex/overflow ancestors matter), and link the production CSS fetched from `web.readest.com` (`/_next/static/css/*.css`, it includes the `[data-theme=…]` blocks). Measure `getBoundingClientRect` and `scrollHeight` rather than only looking at screenshots.
- #7181 cause: `h-full` on grid items in content-sized rows inside nested column flexboxes. Safari 16 resolved it against ~viewport/2 − 72px (179px on a phone), and `overflow-hidden` clipped the card. Fix: drop `h-full` (grid items stretch anyway). Chromium and current WebKit never show it, so the repo's Chromium-only browser tests can't catch it.
- Doesn't cover compositing/scroll bugs: this is desktop WebKit, not iOS.

Related: [[ios16-sharekit-url-parse-6719]], [[ios-sim-webview-drive-via-iwdp]]
