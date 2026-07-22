---
name: pdf-oom-range-flood-3470
description: "Android/iOS large-PDF import/open OOM (#3470) = unthrottled pdf.js range-request flood, not whole-file load; fix = concurrency cap in foliate makePDF"
metadata: 
  node_type: memory
  type: project
  originSessionId: 1f5ecad5-076c-4170-939a-c80438c37f64
---

# Large-PDF OOM on Android/iOS (#3470)

**Symptom:** importing/opening a 50 MB+ PDF crashes (no message) with
`java.lang.OutOfMemoryError ... target footprint 536870912` (512 MB Java heap)
at `RustWebViewClient.handleRequest` ← `shouldInterceptRequest`. Same file is
fine in the official pdf.js viewer on Android Chrome. Repro file: `100个句子记完7000个雅思单词.pdf` (67 MB, 970 pages).

**Root cause (NOT whole-file load):** opening the PDF makes pdf.js fire ~759
small **64 KB** range reads to parse scattered xref/object streams. foliate-js
`makePDF` fulfilled every `requestDataRange` with an **un-awaited**
`file.slice(begin,end).arrayBuffer()` → all dispatched at once (measured
**maxInFlight 753**). On Android each read is a `fetch()` to the `rangefile`
scheme → `shouldInterceptRequest` allocates a Rust `Vec<u8>` + a Java `byte[]`
per request; ~750 simultaneous intercepted requests exhaust the 512 MB Java
heap. The official pdf.js viewer survives because the **browser caps ~6
connections/host**; the custom `rangefile` (and iOS native-file) scheme has no
such cap. Explains "50 MB+" (bigger PDF → more scattered objects → bigger
flood) and "crashes on some devices only" (heap/WebView threshold).

**Fix (RESOLVED — foliate-js#31 squash `e098bc3` + readest#4670, both merged):** `packages/foliate-js/pdf.js` `makePDF` — queue + pump bounding
range reads to `MAX_CONCURRENT_RANGES = 6` (mimics the browser's per-host
limit). One spot covers Android `RemoteFile`, iOS `NativeFile`, web `File`.
Throttling is **free** on speed (6 parallel fetches saturate throughput). foliate-js
is a **git submodule** → commit + push to readest fork, then bump pointer.
Test: `src/__tests__/foliate-pdf-range-concurrency.test.ts` — `vi.mock('@pdfjs/pdf.min.mjs')` installs a fake `globalThis.pdfjsLib` whose `getDocument` fires a 200-call flood; asserts `maxInFlight ≤ 6` and all served. Fails (200) before, passes after.

## On-device CDP verification recipe (no rebuild)
Release Readest 0.11.10 ships a debuggable WebView (socket
`webview_devtools_remote_<pid>`), so CDP attaches without `run-as`.
- `adb forward tcp:9222 localabstract:webview_devtools_remote_$PID`; page WS from `curl :9222/json`.
- Push file where asset scope allows: `/sdcard/Readest/Books/` matches scope glob `**/Readest/**/*`; app has MANAGE_EXTERNAL_STORAGE → readable. Canonical path `/storage/emulated/0/Readest/Books/x.pdf`.
- rangefile URL: `http://rangefile.localhost/?path=<encodeURIComponent(abs)>&start=&end=` (end **inclusive**, omit=EOF, 8 MB cap, returns 200 + `X-Total-Size`).
- Faithfully replicate `makePDF`: `await import('http://tauri.localhost/vendor/pdfjs/pdf.min.mjs')` (sets `globalThis.pdfjsLib`, same vendored 5.7.284), a file-like `{size, slice(b,e)→{arrayBuffer:()=>fetchRangePart(b,e-1)}}`, `new pdfjsLib.PDFDataRangeTransport(size,[])`, instrument `requestDataRange`, `getDocument({range,wasmUrl:'/vendor/pdfjs/',cMapUrl,standardFontDataUrl,isEvalSupported:false})` then `getPage(1)/getViewport/getMetadata`.
- Java heap via `adb shell dumpsys meminfo com.bilingify.readest` (Dalvik Heap line).

**Verified on Xiaomi 13 (fuxi) / Android 16 / WebView 147 / 8 GB:** this device does NOT OOM (newer WebView; Dalvik only +9 MB) but the flood reproduces: **753 → 6** concurrent, open time **1446 → 1479 ms** (no penalty), 970 pages/title/viewport identical. Gotcha: package installs (`installPackageLI` in logcat) kill the app mid-session → re-discover the devtools socket PID. The makePDF flood alone did NOT crash this device — can't get a live OOM here; rely on the user's WebView-145 log + the bounded-concurrency proof.

Related: [[android-nativefile-remotefile-io]] (rangefile vs asset-protocol Range bug), [[webtoon-mode-3647]] (foliate-js submodule fork-push).
