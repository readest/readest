---
name: koplugin-macos-fork-getaddrinfo-6933
description: "macOS 26+ crashes KOReader's forked sync workers in getaddrinfo; koplugin workers now use AF_INET sockets (MERGED #7021, 854fb74d9), unverified on macOS 26/27"
metadata:
  node_type: memory
  type: project
  originSessionId: 5336425d-49ea-4088-830b-4496cf377519
  modified: 2026-10-23T12:26:18.846Z
---

#6933: on macOS 26+, a fork()ed child of a multi-threaded process (KOReader's SDL/AppKit parent) crashes in getaddrinfo when an AF_UNSPEC lookup returns only A records (`_gai_nat64_second_pass` → os_log; Apple FB21364061, won't-fix stance from DTS). AF_INET lookups, numeric IPs and hosts with AAAA are reported immune. Supabase auth host has no AAAA, so token refresh always crashed.

Fix MERGED 2026-10-23 as #7021 (854fb74d9): `ReadestSyncClient.useIPv4InWorker()` swaps `socket.tcp` for `socket.tcp4` (keeping socketutil timeouts) in the child only, on `jit.os == "OSX"`; called in `_dispatchInSubprocess` (covers refresh_token), `downloadBook`, `downloadCover`. Maintainer rejected the "skip fork on macOS" approach: keep async.

**Why:** can't reproduce on macOS 15.x; verified only that the fixed path works on 15.6 (IPv4 worker sockets via lsof, pull/push/refresh succeed).
**How to apply:** still needs a macOS 26/27 confirmation from the reporter. KOReader's own forked network code (Wikipedia, NewsDownloader) has the same exposure upstream. Socketutil patches `socket.tcp` with a captured upvalue, so any replacement must reapply the timeouts itself.

Headless check recipe: run a script with the emulator's `./luajit` after `require("setupkoenv")`, set `G_defaults`/`G_reader_settings`, stub `ui/uimanager` with an inline scheduler, then call the real client; SIGTERM does not quit the emulator (Alt+F4 synthesized but ignored).
