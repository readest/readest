---
name: kosync-connect-false-positive-4692
description: "KOSync connect() accepted any 2xx (even an HTML web-UI page) as login → misconfigured Server URL silently \"connects\" but never syncs"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 43e853c2-58ea-42f0-97ed-66aa3f65e4d1
---

#4692 (PR #4711): KOReader Sync to a self-hosted Grimmory/Booklore server failed on Android (worked on iOS). Root cause was a **misconfigured Server URL** that resolved to the host's static web UI instead of the sync endpoint, made undebuggable by a Readest gap.

**Server-side tell (the smoking gun):** Android `PUT /syncs/progress` was handled by Spring's `ResourceHttpRequestHandler` → `HttpRequestMethodNotSupportedException: Request method 'PUT' is not supported`. That handler is Booklore's SPA/static fallback — so the request reached the server but **missed the koreader controller** and hit the catch-all static handler. GET requests (auth/pull) silently get the HTML index with 200; only PUT errors (static handler rejects non-GET/HEAD).

**Readest gap:** `KOSyncClient.connect()` treated any 2xx from `/users/auth` (or `/users/create`) as success. An HTML web-UI page returns 200 → false-positive "connected"; then pulls show 0% and pushes fail with no error surfaced. Matches the classic "no errors reported, still 0%" report.

**Fix:** validate the auth/registration response is an actual koreader JSON object (real server → `{"authorized":"OK"}`; HTML fails `response.json()`), else return "Not a KOReader Sync server. Check the Server URL." (`isKoSyncJsonResponse` helper in `KOSyncClient.ts`). Catches misconfig at setup, when actionable.

**Still silent (intentional follow-up, not done):** per-sync push/pull failures. `getProgress`/`updateProgress` collapse "request failed" and "no remote data" into the same `null`/`false`; naive toasting would fire on every transient auto-push (5s). Needs noise-aware design before surfacing.

KOSync settings are **per-device** (no Readest account → not synced across devices), so iOS vs Android URLs are entered independently — the #1 suspect when one platform syncs and the other doesn't. Related: [[kosync-cfi-spine-resolution]], [[empty-start-cfi-sync]].
