---
name: tauri-channel-progress-after-invoke-resolves
description: "Tauri Channel progress messages can arrive AFTER the invoke promise resolves, so any progress-cleanup pair needs a latch or the stale entry is never cleared"
metadata: 
  node_type: memory
  type: project
  originSessionId: da8305fd-859c-49bd-99af-f8afabbfaa12
  modified: 2026-08-16T08:45:05.920Z
---

`tauriDownload` / `tauriUpload` (`src/utils/transfer.ts`) pass a `Channel<ProgressPayload>`
to `invoke('download_file' | 'upload_file')`. Channel messages are delivered over
IPC **independently of the invoke response**, so a final payload can land *after*
the awaited command already resolved.

Any `onProgress` -> `cleanup()` pair therefore needs a latch. Without one the late
event re-arms the throttle, re-creates the entry cleanup just deleted, and
**nothing runs cleanup a second time** — the UI is stuck permanently.

Confirmed empirically on #5736: a test that fired the captured handler after
`await handleBookDownload(...)` and advanced timers left `{ 'book-1': 90 }` in
state, stranding the book cover behind a stale progress overlay with its action
button hidden (the button was suppressed on `progress !== null`).

**How to apply** — return a latched pair rather than a bare handler:

```ts
let settled = false;
return {
  onProgress: (p) => { if (!settled) throttle.push(p); },
  done: () => { settled = true; throttle.cancel(); /* drop entry */ },
};
```

`transferManager.ts` already guards its own handler with
`abortController.signal.aborted`; hand-rolled progress paths must do the
equivalent. Also prefer `throttle.cancel()` over `flush()` when clearing right
after — `flush()` emits a value the next updater immediately deletes.

Related: [[transfer-queue-clear-persistence]].
