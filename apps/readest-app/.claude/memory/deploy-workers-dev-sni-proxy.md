---
name: deploy-workers-dev-sni-proxy
description: "pnpm deploy crashes in China — workers.dev SNI-blocked, wrangler ws WebSocket bypasses http_proxy; fix = NODE_OPTIONS preload"
metadata: 
  node_type: memory
  type: project
  originSessionId: 65342d98-7939-41ed-9e10-2efc466946b1
---

`pnpm deploy` (and `pnpm upload`) crashed for chrox (behind GFW, Privoxy at `http://127.0.0.1:8118`) with an **unhandled `ws` `'error'` event → Node process crash** (ETIMEDOUT to Facebook/Vultr/Twitter IPs).

**Trigger:** `opennextjs-cloudflare deploy`/`upload` ALWAYS runs `populateCache({target:"remote"})` BEFORE the real deploy (no skip flag; only `cacheChunkSize`/`env` knobs). That step calls wrangler's `unstable_startWorker({remote:true})`, which opens a **WebSocket** to a `*.workers.dev` edge host. (`preview` uses `target:"local"` → unaffected.)

**Root cause (two layers):**
1. `*.workers.dev` is **SNI-blocked** by the GFW, not merely DNS-poisoned. Proof: encrypted DoH gives the REAL Cloudflare IPs (104.18.x), but a *direct* TLS connect to that correct IP with SNI=workers.dev is still `Connection reset by peer` before TLS starts. So **DoH/dnscrypt-proxy does NOT help** — the connection must avoid being made directly at all.
2. wrangler's REST calls honor `http_proxy` (undici `ProxyAgent`/`EnvHttpProxyAgent`), but the raw `ws` handshake falls back to `https.globalAgent` and **ignores proxy env**. So it connects directly → SNI reset → crash. The crash fires async (unhandled WS 'error'), so `opennextjs-cloudflare deploy`'s `await` can't catch it.

**Attempt 1 — proxy preload (tried, then REMOVED):** a zero-dep preload that replaced `https.globalAgent` with a `CONNECT`-tunnel agent (CONNECT hides the SNI = defeats the block + does remote DNS; loopback bypassed so the local populate worker on 127.0.0.1 still works). Verified `https.get('https://workers.dev')` → 301 via proxy. This got PAST the WebSocket crash — the local populate worker started and enumerated all 17 cache assets — **BUT the actual R2 writes through the remote binding then timed out** ("Failed to send request to R2 worker: aborted due to timeout", retrying forever). The proxy establishes the connection but can't reliably carry the sustained cache-write traffic. So the preload alone is NOT sufficient. Deleted it.

**Attempt 2 — replicate `wrangler deploy` in the npm script (tried, then reverted):** skip populate by bypassing `opennextjs-cloudflare deploy` and running `CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false OPEN_NEXT_DEPLOY=true wrangler deploy` directly (traced from `runWrangler`: stock deploy's real step is plain `wrangler deploy` vs `wrangler.toml` which has `main=.open-next/worker.js`+all bindings; no generated config/skew mapping; the env flag stops wrangler 4.x auto-loading `.env`/`.dev.vars` into the worker — OpenNext's adapter handles env). Works, but hacky (replicates internals, drift risk).

**Fix that SHIPPED — config flag (cleanest).** populateCache is gated by `if (!config.dangerous?.disableIncrementalCache && incrementalCache)`. So in `open-next.config.ts`: `config.dangerous = { ...config.dangerous, disableIncrementalCache: true }`. This makes the STOCK `opennextjs-cloudflare deploy`/`upload` skip populate (no script hack, no env flag, no drift) — reverted package.json to stock. Caveat: it's the SAME flag the runtime reads, so it ALSO disables the runtime incremental cache — **but readest uses ZERO ISR (no `revalidate`/`unstable_cache`/`'use cache'`/`generateStaticParams`), so runtime caching is a no-op anyway → no real loss.** Re-enable = delete the one line (from a network that can reach the CF edge). `defineCloudflareConfig` returns `OpenNextConfig` (broad type; `dangerous.disableIncrementalCache?: boolean` exists), tsgo+biome clean. `preview` was always fine (local populate).

Related: [[turbopack-build-cache-oom-docker-standalone]], [[r2-rclone-createbucket-403]].
