---
name: cf-worker-64mb-turbopack-regression
description: Cloudflare deploy failed 64 MiB worker limit; root cause was
metadata: 
  node_type: memory
  type: project
  originSessionId: 74519cda-4e22-4734-8ce8-1001f104b4dd
---

`pnpm deploy` (opennextjs-cloudflare) started failing "Worker exceeded the uncompressed size limit of 64 MiB" on `dev` after 0.11.18. Worker script was 88 MiB.

**Root cause (non-obvious):** OpenNext builds by running `pnpm build` (the package.json `build` script; confirmed in build log). `patch-build-webpack` forces webpack via `sed 's/next build"/next build --webpack"/'` — matches only a script *ending* in `next build"`. PR #5027 (sourcemaps) appended `&& node scripts/upload-sourcemaps.mjs` to `build`, so it no longer ended in `next build"`; the sed silently stopped matching and the deploy fell back to **Turbopack** (Next 16 default). Turbopack's server bundle is much larger + less tree-shaken than webpack's, blowing past 64 MiB. Also breaks serwist (PWA) which doesn't support turbopack. So the user's "it's the sourcemap PR" instinct was right — via a broken sed, not sourcemaps themselves.

**Sourcemaps do NOT count** toward the CF worker size limit: wrangler generates worker.js.map (~82 MiB) separately; "Total Upload" == sum of script modules excluding the map. Verified via `wrangler deploy --dry-run --minify --outdir X` then summing files excluding `*.map`.

**Fixes applied (all four):**
1. Split `build` back to `dotenv -e .env.tauri -- next build` + new `upload-sourcemaps` script; Tauri `beforeBuildCommand` = `pnpm build && pnpm upload-sourcemaps`. Restores webpack for the deploy. **This alone is the regression fix.**
2. `deploy` adds `opennextjs-cloudflare deploy --minify` — wrangler doesn't minify by default and re-expands the already-minified handler.mjs (+~18 MiB of whitespace, 849k lines). OpenNext yargs uses `unknown-options-as-args:true` and strips `--`, so `deploy --minify` (no `--` separator) forwards to wrangler.
3. Swap `googleapis` barrel (verifier.ts, only importer) → `@googleapis/androidpublisher` (`androidpublisher({version:'v3',auth})`, same underlying client). googleapis meta-package = ~11.6 MiB of the handler (22k refs, all Google APIs).
4. Exclude browser-only WASM from the SERVER bundle only: next.config webpack `(config,{isServer})` alias `'@readest/turso-database-wasm/webpack': false` + `'jieba-wasm': false` gated on `isServer && appPlatform==='web'`. turso (in-browser DB via WebDatabaseService) was double-bundled = 24 MiB; jieba (browser CJK segmentation) 3.8 MiB. Both only run client-side. Turbopack `resolveAlias` can't do isServer conditions, which is why this needs the webpack build.

**Result:** worker 88 MiB → **22.3 MiB** (webpack build, `wrangler deploy --dry-run --minify`). A stray turso.wasm (12 MiB) remains on disk in `.open-next/server-functions` (nft traces the pkg dir) but is NOT imported → not in the wrangler bundle, doesn't count.

**Gotcha:** `patch-build-webpack`'s sed is self-referential-safe ONLY because JSON escapes `"` → `\"`, so pattern `next build"` doesn't match the pattern text `next build\"` inside the patch/restore definitions. Don't rewrite it to match `next build &&` (unescaped) — that self-corrupts package.json on run. `strip-web-sourcemaps` must target `.open-next/assets` (the served maps), not `.next`.
