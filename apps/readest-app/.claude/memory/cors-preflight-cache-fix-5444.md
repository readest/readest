---
name: cors-preflight-cache-fix-5444
description: "#5444 CORS preflight cache fix VERIFIED in prod: OPTIONS dropped ~83% within minutes of deploy; also the recipe for querying CF worker metrics via wrangler OAuth token"
metadata: 
  node_type: memory
  type: project
  originSessionId: bb9fe665-4482-4621-a277-a99332d2e005
  modified: 2026-08-02T19:58:59.692Z
---

PR #5444 (`c181e6f5e`, merged 2026-08-02) replaced `Access-Control-Allow-Headers: *` with echoing
`Access-Control-Request-Headers` (fallback `Authorization, Content-Type`) + `Vary: Origin,
Access-Control-Request-Headers` in `src/middleware.ts`, because the Fetch spec excludes
`Authorization` from wildcard matching in the browser preflight cache — so every authenticated call
from Tauri clients (origin `http://tauri.localhost`) re-preflighted despite `Max-Age: 86400`.

**Verified in production 2026-08-02** (deploy 19:35:50 UTC): minute-level zone analytics showed
OPTIONS collapse from ~2,200/min (35–40% of all requests) to ~350/min (~7.6% share) within 20
minutes — an ~84% OPTIONS reduction; total worker requests fell ~30%. Residual preflights are
expected: first-hit per client per URL, and Chrome caps `Access-Control-Max-Age` at 2 hours
regardless of the header.

**How to check readest-web CF metrics** (no API token in .env files needed):
- wrangler OAuth token from `~/.wrangler/config/default.toml` (`oauth_token = "..."`) works as a
  Bearer token for `https://api.cloudflare.com/client/v4/graphql` and REST.
- Account `69a7e6e1c1cf4ecba13b6eb603210dfe` (Readest), zone readest.com =
  `f697810279605f42c6588e1abb3273b4`; worker `readest-web` serves web.readest.com,
  web-cf.readest.com, api-cf.readest.com.
- Dataset `httpRequestsAdaptiveGroups` with `clientRequestHTTPMethodName` + `datetimeHour`/
  `datetimeMinute` dimensions; estimate = `count * avg.sampleInterval`. The zone plan rejects
  time ranges wider than **1 day** per query — window the queries.
- Deploy timestamps: REST `GET /accounts/{acct}/workers/scripts/readest-web/deployments`.
- Note the OAuth token is short-lived; wrangler refreshes it when used. `npx wrangler whoami` can
  take >120s behind the proxy.
