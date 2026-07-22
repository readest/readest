---
name: ios-sim-drive-via-dev-server-relay
description: How to drive/verify the Readest iOS-simulator app - temp dev-server eval relay works; iwdp/idb dead ends; tauri ios dev port-3000 conflict symptom
metadata: 
  node_type: memory
  type: project
  originSessionId: 5e4be60f-c98e-4061-a5e7-96b791b6da34
---

Driving the app in the iOS simulator for verification (no computer-use):

- **Works**: temp relay through the dev server. `tauri ios dev` proxies the dev server through
  `tauri://localhost` (relative `fetch('/api/...')` from the webview reaches next dev, API routes
  included). Add a throwaway route `src/app/api/verify-tmp/route.ts` (command queue + results) and a
  poller in `Providers.tsx` that `eval`s snippets and posts results; issue commands with curl/jq from
  the Mac. NOTE: `_`/`__`-prefixed app-router folders are PRIVATE (unrouted) — `api/__verify` 404s.
  Delete both before committing. Screenshots: `xcrun simctl io booted screenshot`.
- Toggling reader bars synthetically: `window.postMessage({bookKey, type:'iframe-single-click',
  screenX: innerWidth/2}, '*')` hits the usePagination center-tap zone (37.5%–62.5%). bookKey via
  `document.querySelector('[id^=gridcell-]').id.slice(9)`.
- **Dead ends**: ios_webkit_debug_proxy 1.9.2 (`-s UNIX:$(ls -t /tmp/com.apple.launchd.*/com.apple.webinspectord_sim.socket | head -1)`)
  never attaches the iOS 18 sim (socket connects, no device registers); it does expose a physical
  iPhone's Readest (tauri.localhost) if Web Inspector is on. `simctl` has no tap. idb-companion has
  no arm64 bottle (source build wants CLT). Desktop Simulator clicks need computer-use (single lock —
  busy if another session holds it).
- **`tauri ios dev` failure mode**: an orphaned `pnpm dev` on port 3000 makes next dev pick 3001,
  then die with "Another next dev server is already running" → beforeDevCommand exits → xcodebuild's
  `tauri ios xcode-script` panics "failed to read CLI options … ConnectionRefused". Fix: kill the
  orphan chain (`lsof -ti :3000`), rerun.
- In Chrome verification, `Shift+F` opens the reader's Font & Layout settings dialog (Show Footer
  toggle lives there); the desktop footer bar has no font button (that list includes hidden mobile
  NavigationBar buttons — filter by `offsetParent !== null`).
