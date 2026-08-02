---
name: import-pdf-worker-leak-5387
description: "#5387 Android batch-PDF-import crash = one leaked pdf.js DedicatedWorker (~60MB) per imported PDF; importBook never called destroy; 32-bit WebView renderer OOM-traps, then crashpad aborts the app (no onRenderProcessGone)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 4444ff7f-e04c-4e82-b7b1-27fbf5de4c95
  modified: 2026-08-02T10:06:47.376Z
---

# #5387 Importing many PDFs crashes Android (renderer OOM via leaked pdf.js workers)

**Two-layer crash (OPPO PHJ110H2, Android 13, 0.11.20, log attached to issue):**
1. `CrRendererMain` SIGTRAP = Chromium deliberate OOM trap. Renderer is **32-bit**
   (`ABI: 'arm'` — TrichromeLibraryCN), so address space is tight.
2. App process then dies by design: `crashpad_client_linux.cc(724) "Render process
   crash wasn't handled by all associated webviews, triggering application crash"`
   — Tauri/wry has **no `onRenderProcessGone` handler**. Follow-up not done;
   matches Sentry READEST-P ([[sentry-crash-reporting-4914]]).

**Root cause (verified on Xiaomi 13 / WebView canary 153 via CDP, 67MB repro PDF):**
`bookService.importBook` runs the full `makePDF` parse (getDocument + getMetadata +
getOutline + page-1 cover render) but **never called `loadedBook.destroy()`** — its
only cleanup closed the original `file` arg (a string → dead code). Dropping refs
does NOT free a pdf.js doc: the dedicated worker survives GC. Measured per import
of the [[pdf-oom-range-flood-3470]] repro file: **+51–68 MB renderer PSS and +1
DedicatedWorker thread, linear** (174→533 MB over 6 imports, forced GC between);
with `destroy()` after each: flat ~174 MB, 0 workers. Library page imports 4
concurrently → batch of N PDFs ≈ N×60 MB until renderer OOM.

**Relation to #3470:** `MAX_CONCURRENT_RANGES=6` only caps *in-flight* range reads
(protects native/Java heap in `shouldInterceptRequest`). It does not bound the
chunks the worker *retains* (scattered-metadata PDFs retain more), and it can't
help when whole documents leak.

**Fix (MERGED #5439):** `BookDoc.destroy?()` added to the
interface; `importBook`, `refreshBookMetadata`, `fetchBookDetails` destroy the doc
+ close the opened `fileobj` in `finally`. Test:
`src/__tests__/services/import-bookdoc-destroy.test.ts` (models the
import-metahash harness). PSE-stream / native-bridge docs have no destroy → no-op.

## CDP-on-release-app gotchas (adds to the #3470 recipe)
- websocket-client needs `suppress_origin=True` — Chrome 111+ 403s the default
  `Origin: http://127.0.0.1:9222` on the devtools WS.
- `rangefile` 403 on a valid path = app lacks All Files Access → scope
  canonicalize fails. `adb shell appops set com.bilingify.readest
  MANAGE_EXTERNAL_STORAGE allow`, then force-stop + relaunch (new pid → new
  `webview_devtools_remote_<pid>`).
- Set `pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs'`
  before getDocument in injected probes.
- Count leaked workers: `grep -c DedicatedWorker /proc/<renderer-pid>/task/*/comm`;
  renderer PSS: `dumpsys meminfo <pid>` "TOTAL PSS". Two sandboxed processes may
  exist; Readest's is the one whose PSS moves.
