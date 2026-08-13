---
name: azure-translator-edge-auth-retired
description: "Azure/Bing translator provider — edge.microsoft.com/translate/auth died 2026-07-30; migrated to bing ttranslatev3 with a web proxy, 1000-char cap and concurrency gate"
metadata: 
  node_type: memory
  type: project
  originSessionId: 23d24f5c-e4dc-482d-b692-69a990218a23
  modified: 2026-08-11T00:18:07.412Z
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

**Follow-up regression found 2026-08-11 (fix in PR #5620, branch
`fix/azure-translator-bing-lang-codes`): the migration kept `normalizeToFullLang`, and bing
rejects maximized culture codes.** ttranslatev3 accepts ONLY its
own language list — bare subtags plus script variants (`en`, `ja`, `zh-Hans`) — and answers
`statusCode: 400` (inside HTTP 200, empty errorMessage) for `en-US`, `de-DE`, `zh-CN`. The old
api-edge endpoint tolerated full culture codes, which is why `normalizeToFullLang` survived since
2024. Every non-Chinese target failed ("Unable to fetch the translation. Try again later." in
TranslatorPopup); the #5555 desktop verify passed only because its target normalized to zh-Hans.
Fix: `azure.ts` now uses `normalizeToShortLang` like every other provider; the hand-rolled
`@/utils/lang` mock in `providers.test.ts` (whose fake normalizeToFullLang mapped en→en, hiding
the maximization) was deleted so provider tests run the real normalizers. Verified on the
Xiaomi 13 in the real popup (en→zh-Hans renders) AND a live sweep: all 42 normalized codes for
the selectable TRANSLATOR_LANGS translate, zero 400s. Device-probe trick worth reusing: CDP
`Runtime.evaluate` replicating `plugin:http|fetch` IPC verbatim reproduces exactly what
tauriFetch sends — the bing scrape+translate worked from the installed app before the fix, which
is what isolated the failure to the `to=` parameter rather than headers/Origin/scope.
