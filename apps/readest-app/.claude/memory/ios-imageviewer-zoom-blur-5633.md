---
name: ios-imageviewer-zoom-blur-5633
description: "#5633 iOS image viewer blurry at same zoom % as Android — WebKit rasters img at LAYOUT size, transform scale only stretches; fix = commit settled zoom into layout width/height"
metadata: 
  node_type: memory
  type: project
  originSessionId: 73b1b43b-4f46-4e70-a0aa-12c2963d368b
  modified: 2026-08-12T14:38:39.033Z
---

**#5633:** at the same zoom badge % the ImageViewer was sharp on Android, blurry on iOS. Data path was byte-perfect (original blob → data URL); the loss was pure render path.

**Mechanism (proven, not inferred):** iOS WebKit decodes/rasterizes an `<img>` at its *layout* size and `transform: scale()` merely stretches that raster — with or without `willChange`/layer promotion (tested both). Chromium re-rasterizes tiles at the transformed scale, which is why identical code was sharp on Android. Proof: standalone 3-panel page on the iOS sim (same JPEG, same displayed size) — fit-layout+transform blurry, layout-sized sharp, transform-without-willChange still blurry. So "drop the GPU hint" is NOT a fix.

**Fix (ImageViewer.tsx):** keep gestures on the transform; when the zoom settles (no drag/wheel stream, +100ms), commit `renderScale` into explicit layout `width/height = fitSize × renderScale` and render `transform: scale(scale/renderScale)`. Commit clamps to `pixelPerfectScale` (never raster beyond 1:1) and to `MAX_COMMIT_RASTER_DIM = 4096` device px per side (a huge scan must not OOM the iOS WebContent process — the [[pdf-ios-webcontent-oom-zoom-5118]] lesson). Fit size now computed from the container rect + natural size (formula replicates `width:auto` + `maxW/maxH:100%`), NOT `offsetWidth` — once committed, offsetWidth is no longer the fit size. `flexShrink: 0` is load-bearing: without it the centering flexbox clamps the committed width back to the container. Translate must divide by the *applied* factor (`scale/renderScale`) so screen offset is invariant across the commit; verified zero-jump in Chrome (rect 691.46→691.5px).

**Transition wobble guard:** the committing render swaps width and transform in one frame; a `commitJustApplied` ref forces `transition: none` for exactly that render.

**Still unfixed sibling:** TableViewer.tsx uses the same fit-layout + transform-scale pattern → zoomed tables are equally blurry on iOS.

**Verify status:** MERGED #5639 (2026-08-12); unit tests (3 new contract tests) + full suite + lint green; WebKit A/B proof on sim; integration verified in Chrome; reporter-device / sim in-app verify still pending. The sample book stays transplanted in the iPhone 17 Pro sim (app + book installed; boot sim, dismiss the stale "Open in Readest?" alert, open book, double-tap cover). #5639's `build_tauri_app` CI failure was NOT this change: test-tauri.sh started the 300s webdriver wait before `tauri dev`'s Rust compile (4m54s cold) — fixed in MERGED #5644 (own 900s WEBDRIVER_TIMEOUT + dorny/paths-filter gate so frontend-only PRs skip the job; validated green on a full cold build). In-app iOS sim verify blocked mid-session (computer-use lock held by another session; Simulator.app had NO window headless — System Events sees zero windows, simctl framebuffer screenshots still work; `brew install idb-companion` refused without CLT). Sim left booted with the fix build + sample book (hash 95d7d352…) transplanted from the desktop library into the sim data container; reporter-device verify pending.

**Sim tricks that worked:** serve test page from host `python3 -m http.server` and `simctl openurl booted http://127.0.0.1:PORT/...` (sim shares host loopback; openurl may report timeout while Safari still loads the page). Book injection without UI: copy `Books/<hash>/` from `~/Library/Application Support/com.bilingify.readest/Readest/Books/` into the sim container + splice the entry into `library.json` (terminate app first). `readest://book/<hash>` opens it but SpringBoard asks "Open in Readest?" (one tap, undriveable headless). Web-app import without native picker: patch `HTMLInputElement.prototype.click` to capture the input `useFileSelector` creates, then set `.files` via `DataTransfer` and call `onchange`.
