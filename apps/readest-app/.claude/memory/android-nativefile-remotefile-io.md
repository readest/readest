---
name: android-nativefile-remotefile-io
description: "Why NativeFile is slow on Android, why RemoteFile (range fetch) can't replace it (asset-protocol Range is broken), measured CDP numbers, and the viable speedups"
metadata: 
  node_type: memory
  type: project
  originSessionId: 8057ac9c-2e3e-446d-86aa-29baddfbfe66
---

On-device investigation (Xiaomi 2211133C, Android 16, WebView/Chrome 147, wry 0.54.4) of `src/utils/file.ts` `NativeFile` vs `RemoteFile` Android I/O. Verified live via CDP injection into the running app's WebView.

**Why NativeFile is slow (root cause):** `NativeFile.readData` → `#readAndCacheChunkSafe` does `open()+seek()+read()+close()` = **4 Tauri IPC round-trips per chunk**, opens a FRESH handle every chunk (never reuses `this.#handle`), and `read()` ships raw bytes across the Android Kotlin↔JS IPC bridge (serialization cost = the unresolved tauri-apps/tauri#9190). Code already notes "~400 ms per IPC round-trip" at `nativeAppService.ts:313`.

**Can RemoteFile replace NativeFile on Android? NO** — and whole-file load is NOT an alternative (RemoteFile's whole point is random access WITHOUT loading the file into RAM). The Tauri/wry Android **asset protocol mishandles Range requests** (still true on WebView 147), which is exactly `RemoteFile.fetchRange`'s mechanism:
- `Range: bytes=START-…` with **START ≥ 1024 → hard `TypeError: Failed to fetch`**; `0 ≤ START < 1024` → body truncated to `1024-START` bytes. Reading the zip central directory (EOF) / OPF / cover = non-zero offsets = all fail. "Known issue" at `nativeAppService.ts:244` — confirmed STILL broken.
- **ROOT CAUSE (localized):** Tauri's `crates/tauri/src/protocol/asset.rs` range logic is CORRECT (seek+read [start,end], 206, Content-Range, Content-Length; `MAX_LEN=1000*1024` cap is BY DESIGN — RemoteFile already chunks at the same `MAX_RANGE_LEN`). The bug is in **wry `src/android/binding.rs`**: it STRIPS the `Content-Length` header ("WebResourceResponse will auto-generate") and hands Android a `ByteArrayInputStream` of the already-sliced partial body + a `Content-Range` header. The Android WebView then **double-applies the offset** (skips another `start` bytes) → `1024-start` truncation, empty body for start≥1024. **Unchanged through wry 0.55.1**, so bumping wry won't fix it; needs an upstream wry patch (or local vendor/patch) and fights Android's intercepted-206 quirks.
- Plain `fetch(assetUrl)` (no Range) returns the full file fast — but loading the whole file defeats RemoteFile's purpose, so NOT a fix.

**Measured (10 MB mobi, 1 MB chunks):** native fresh-handle **44 MB/s** (222 ms) · native one-handle **100 MB/s** (98 ms) · asset plain-fetch **281 MB/s** (35 ms, full file correct). Per-call 4 KB scattered read via NativeFile ≈ **16 ms/op** (kills imports doing many small reads). So: plain-fetch is **6.3×** native and **2.8×** one-handle; just reusing the handle is **2.3×**.

**Per-IPC decomposition (warm):** open 1.33 ms, seek 0.60 ms, read(4 KB) 3.02 ms (read carries ~2.4 ms fixed bridge-serialization beyond the round-trip = the tauri#9190 ceiling), seek+read(1 MB) 8.18 ms.

**SOLUTION (implemented, branch `feat/android-rangefile-protocol`, verified on-device):** a custom `rangefile` URI scheme (`src-tauri/src/range_file.rs`, registered via `register_asynchronous_uri_scheme_protocol`) that carries the byte range in the URL **query** (`http://rangefile.localhost/?path=&start=&end=`) instead of a `Range` header. With NO `Range` header the WebView does no offset re-application and delivers the 200 body verbatim — while bytes still stream through the WebView network stack (not the IPC bridge). Returns 200 + `X-Total-Size` (no `Content-Range`); scope-gated by `asset_protocol_scope().is_allowed()` (same security as asset protocol). TS side: `RemoteFile.fromNativePath(absPath)` (query-range mode, reads `X-Total-Size` on open, `&start=&end=` per fetch, no Range header); wired into `nativeAppService.openFile` Android branch with NativeFile fallback; CSP += `http://rangefile.localhost`.
  - **Verified on Xiaomi/Android 16 via CDP:** byte-equal to NativeFile ground truth at ALL offsets (0,1,1024,64K,1M,5M,EOF) — the non-zero starts that failed via asset protocol now work; cache-safe across distinct ranges; real library book opens & renders end-to-end (50 rangefile requests, restored mid-file position). **1.83× faster** small scattered 4KB reads (5.2 vs 9.5 ms); bulk-sequential ≈ par (RemoteFile rarely does whole-file reads; native copyFile fast-path handles those). Why this beat the "200 trick" idea: pre-test showed the WebView re-applies the offset to 200 responses too — it's the *Range request header* that triggers it, so removing the header (range-in-URL) is the actual fix.
  - Why this isn't the "single-call IPC command": IPC still pays the tauri#9190 bridge serialization; the rangefile path streams via the network stack. The IPC command (`open+seek+read+close` → 1 IPC, ~2× small reads) remains a valid simpler fallback if the custom scheme ever regresses.

**Side-observation:** installed build's ACL rejects `plugin:fs|close` (allows open/seek/read) → possible `NativeFile` handle-leak / `close()` throw path; verify `fs:default` grants. See [[cdp-android-webview-profiling]].
