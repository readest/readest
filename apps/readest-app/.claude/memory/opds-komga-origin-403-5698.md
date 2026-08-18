---
name: opds-komga-origin-403-5698
description: PR #5765 suppresses the webview Origin on OPDS requests to fix Komga-behind-nginx 403s; the empty-Origin marker collides with differently-cased custom origin headers
metadata:
  type: project
---

**#5698 Komga OPDS always 403** — PR #5765 MERGED 2026-08-17 as `8fa928051`.
`withOriginSuppressed(headers)` in `src/app/opds/utils/opdsReq.ts` sets `Origin: ''`
on Tauri, applied to the assembled header set in `probeAuth`, `fetchWithAuth`, and
`pseStream.ts`. Issue #5698 is still CLOSED and did not auto-close on merge.
**No device verification yet** — nobody has confirmed the 403 clears on the
reporter's nginx+Komga setup.

Mechanism is real and verified end to end:
- `tauri-plugin-http` 2.5.9 `commands.rs:291` stamps the webview origin
  (`tauri://localhost`, or `http://tauri.localhost` on Android/Windows) on every
  request unless the caller sets one, and `commands.rs:305-309` **removes** an
  explicitly-empty Origin — but only with the `unsafe-headers` feature, which
  `src-tauri/Cargo.toml:55-58` does enable.
- The JS side preserves the empty value: `dist-js/index.js:61-64` builds a
  standalone `new Headers()` (guard "none", so `Origin` is not stripped) and
  `Array.from(headers.entries())` keeps `['origin','']`.

**The 403 comes from nginx, not Spring/Komga.** The issue thread says "Nginx
returns 403, Komga has no access log" — which is exactly why chrox could not
reproduce it against Komga directly on macOS and closed the issue. PR #5765's code
comment blames "Spring-based servers such as Komga"; that misattribution will send
the next debugger into Komga's CORS config. The PR body's "requires HTTPS" claim is
also a red herring: the Origin is stamped identically over HTTP. What matters is an
Origin-checking middlebox in front.

**Defect found in review (FIXED in `7e8bbbcc5` before merge):** the original patch
spread `{ Origin: '' }` ahead of custom headers. It uses capital `Origin`, but
`normalizeCustomHeaders` (`src/utils/customHeaders.ts:23`) preserves the user's
casing. A custom header spelled `origin` survives the object spread as a *second*
key, and `new Headers({Origin:'', origin:'https://x'})` append-merges them into
`origin: ", https://x"` — not empty, so Rust never removes it (still 403), and the
user's Origin is corrupted. See [[plugin-http-empty-origin-case-collision]]. Any
Origin-suppression helper must test keys case-insensitively.

Not affected, verified: book/cover downloads go through `downloadFile` →
`tauriDownload` (Rust reqwest, no Origin). `needsProxy()` is always false on Tauri,
so the `useProxy` branches are web-only. All `fetchWithAuth` retry paths rebuild
from `baseHeaders`, so they inherit the suppression.

**Origin stamping is upstream-by-design, not a bug.** plugin-http emulates browser
`fetch`, so it stamps Origin and drops forbidden headers. Timeline: `unsafe-headers`
added in 2.0.0-beta.3 (plugins-workspace#1050), setting Origin allowed in 2.0.0-beta.6
(#1392), the empty-Origin opt-out in 2.0.1 (#1941), and #3210 in **2.5.6** changed the
value on macOS/iOS/Linux from the literal `null` to `tauri://localhost` (Windows and
Android always sent a concrete origin). Readest took 2.5.6 on 2026-01-16 in `1c9cfa49b`,
shipped in v0.9.98. NOT the trigger for #5698 (filed 7 months later, and a proxy that
rejects an unknown origin usually rejects `null` too), but it changes what a packet
capture shows on Linux.

**Still open (agreed direction, not started):** only ONE of 29 plugin-http call sites
wants a real Origin (`yandexShared.ts:16`, spoofs the Yandex frontend). Everything else
wants none, and `httpFetch.ts:12` already *claims* "no Origin header" while shipping one,
so AI provider calls carry `tauri://localhost` today. Plan is a shared `nativeFetch()`
that normalizes via `new Headers()` (case-insensitive, kills the collision class by
construction) plus a Biome `noRestrictedImports` rule banning direct plugin-http imports.
Checked and NOT at risk: our own API routes validate Origin (`azure-translate/route.ts:37`,
`yandex-translate/route.ts:47`, Stripe redirect URLs) but are reached only via
`window.fetch`, since both translators call upstream directly on Tauri. Migration risk:
`new Headers()` throws on invalid header names where today they fail in Rust.

`tokenEndpoint.ts:52-64` already implements this same opt-out (`ORIGIN_HEADER` /
`NO_ORIGIN`) for OAuth token redemption, ungated by platform. See [[opds-fixes]],
[[custom-headers-kosync-bookorbit-5570]].
