---
name: cf-worker-10m-reqs-preflight-cache
description: "Why readest-web CF Worker sees ~10M req/day — 43% is uncacheable CORS preflights because Allow-Headers `*` never matches Authorization in the preflight cache"
metadata: 
  node_type: memory
  type: project
  originSessionId: 98eb50be-4188-4b3d-b65c-e55e3fe09ae9
  modified: 2026-08-02T14:02:17.232Z
---

Investigated 2026-08-02 via `npx wrangler tail readest-web --format json` (60s sample, 3,891 events ≈ 65 req/s ≈ 5.6M/day off-peak; 967 unique IPs/min, no bots — all authenticated app clients).

Breakdown: /api/sync 66%, /api/send/inbox/claim 17%, /api/sync/replicas 15%. Methods: **43% OPTIONS**, 41% POST, 16% GET.

Root cause of the OPTIONS flood: all Tauri clients call from origin `http://tauri.localhost` → cross-origin, and `Authorization` forces preflight. `src/middleware.ts` replies `Access-Control-Allow-Headers: *` + `Max-Age: 86400`, but per the Fetch spec the wildcard **never matches `Authorization` in the preflight-cache lookup**, so the cache never satisfies the next request → one OPTIONS per API call forever. Evidence: one IP sent 10 OPTIONS + 9 POST to the same bare `/api/sync` URL in 60s.

Fix MERGED in PR #5444 (2026-08-02): middleware preflight branch now echoes `Access-Control-Request-Headers` (fallback `Authorization, Content-Type`) + `Vary: Origin, Access-Control-Request-Headers`; tests in `src/__tests__/middleware.test.ts`. Verify post-deploy by re-tailing: OPTIONS share should collapse from ~43%. Caveats: preflight cache is keyed by exact URL, so GET pulls with changing `since=` query params re-preflight regardless (fix = stable URL/POST body); browser caps max-age (Chromium 2h, WebKit 600s).

Other traffic drivers (per signed-in device): progress push per page turn (`SYNC_PROGRESS_INTERVAL_SEC = 3` debounce in useProgressSync), inbox claim poll every 60s + on focus (useInboxDrainer, runs for every signed-in user regardless of send-to-Readest usage), replica pull 5-min periodic + foreground (10s throttle), per-book `since=0` config/notes/stats pulls on book open with retry chains (top talker showed 7× since=0 pulls/min).

Related: [[sync-pull-10k-worker-1102]], [[multi-provider-cloud-sync-5062]]
