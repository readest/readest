---
name: azure-translator-edge-auth-retired
description: "Azure/Bing translator provider — edge.microsoft.com/translate/auth died 2026-07-30; migrated to bing ttranslatev3 with a web proxy, 1000-char cap and concurrency gate"
metadata: 
  node_type: memory
  type: project
  originSessionId: 23d24f5c-e4dc-482d-b692-69a990218a23
  modified: 2026-08-07T09:25:14.786Z
---

The `azure` translation provider broke on 2026-08-07 with `Failed to get auth token: 404`.
Root cause was upstream, not ours: Microsoft retired `https://edge.microsoft.com/translate/auth`
as part of the Edge-translation shutdown dated **2026-07-30**. The whole `/translate/*`
namespace on that host 404s under every UA/header/path variant (`/translateauth`, `/authv2`,
`/v2/auth` … all gone; a 400 from that host is just its generic unknown-path response, not a
live route). `api-edge.cognitive.microsofttranslator.com/translate` is still alive and returns
a proper 401 — the API works, there is simply no public way left to mint a token for it.

Replacement (shipped): scrape `https://www.bing.com/translator` for auth material and POST to
`https://www.bing.com/ttranslatev3`. Response shape is identical to the old one
(`[{translations:[{text}]}]`). Files: `providers/azureShared.ts` (constants + parser, no
platform imports, shared with the route), `providers/azure.ts`, `app/api/azure-translate/route.ts`.

Hard-won facts, each verified against the live service:

- **bing.com sends NO CORS headers at all.** The old Microsoft endpoints sent
  `access-control-allow-origin: *`, which is why the provider used to call them straight from
  the browser with no proxy and no sign-in. Bing cannot be called from a browser, so web builds
  go through `/api/azure-translate` (mirrors the yandex proxy) and now require sign-in;
  Tauri still calls direct via `tauriFetch`.
- **`IG` and `IID` are mandatory**, not telemetry decoration — omitting either answers
  `statusCode: 400`. Parse both from the page alongside `params_AbusePreventionHelper`.
- **Failures hide inside HTTP 200.** An expired/invalid token is `statusCode: 205`; an
  over-long text is `statusCode: 400`. `response.ok` is never enough — inspect the body.
- **Text cap is exactly 1000 UTF-16 code units, not bytes.** CJK 1000 chars (3000 bytes)
  passes, 1001 fails; 500 emoji (1000 code units) passes. Long paragraphs must be chunked —
  `splitTextIntoChunks` was moved out of `yandex.ts` into `translators/utils.ts` and is now
  shared by both providers.
- **Client concurrency must match the proxy's cap or you DoS yourself.** The first cut fanned
  out an unbounded `Promise.all` over every paragraph against a proxy allowing 3 concurrent per
  user, producing a storm of self-inflicted 429s. `azure.ts` now has a module-level (not
  per-call — the server budgets per user) semaphore at 3.

**Do not diagnose this endpoint from a standalone node/tsx script.** Bing returned HTTP 200 with
a zero-length `text/html` body to every undici request while curl and the real Next.js server
both worked fine with identical headers — cookies, HTTP version and header matrix all ruled out,
so it is fingerprint/soft-throttle behaviour. Verify through the running app instead; see
[[browser-verify-readest-web-recipe]].

Verified in Chrome at `/reader/<hash>`: 21/21 proxy calls 200, zero 429s, zero console errors,
long paragraphs and headings translating inline. Related: [[stale-format-gates-in-settings]].
