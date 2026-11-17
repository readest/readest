---
name: kosync-dev-web-mock-server-recipe
description: "Reproduce KOSync pull/push bugs on dev-web with a ~40-line in-memory mock server; traps with the shell proxy, 127.0.0.1 origin and fresh-book state"
metadata:
  node_type: memory
  type: reference
  originSessionId: ef8c9dd0-30d3-42e6-b01c-29d91945ca5b
  modified: 2026-11-09T10:50:18.549Z
---

Used for #7395 (2026-11-09) to reproduce "Always use latest" ignoring the server on a fresh book, before and after the fix.

- **Mock:** a Node http server for `/users/auth`, `GET /syncs/progress/:doc`, `PUT /syncs/progress`, with CORS `*`. It stores the record in memory and honours a `_timestamp` field so a test can model a report made in the past. An optional `GET_DELAY_MS` holds the answer back to test races. A 127.0.0.1 server counts as LAN in `KOSyncClient`, so the browser calls it directly, with no `/api/kosync` proxy.
- **Document id:** the digest is `partialMD5` of the file (`src/utils/md5.ts`, the same as `book.hash`). Run it with `pnpm exec tsx` from the app dir to seed a record before importing. XPointer for a spine item: `/body/DocFragment[<1-based spine idx>]/body/...`.
- **Shell traps:** the shell has `http_proxy=127.0.0.1:8118`, so curl to localhost returns "Empty reply" unless you pass `--noproxy '*'`. Start servers with the sandbox disabled, or their sockets refuse connections. `pkill -f` missed them; kill by `lsof -tiTCP:<port>`.
- **Browser traps:** Next dev blocks `127.0.0.1:<port>` as an origin (`allowedDevOrigins`); use `localhost`. The KOSync URL field is prefilled with `https://sync.koreader.rocks`, so select all before typing. Import without the file picker by fetching the EPUB from a CORS file server and dispatching dragenter/dragover/drop on `.library-page`.
- **Fresh-book state:** overwrite IndexedDB `AppFileSystem` → `files` → `Readest/Books/<hash>/config.json` with `{"schemaVersion":3,"updatedAt":0}`, then reload. The library's `book.updatedAt` stays the import time. Web window re-activation is `visibilitychange`: override `document.visibilityState` and dispatch the event.
