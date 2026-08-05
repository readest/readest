---
name: deps-security-overrides-workflow
description: "How to fix transitive npm Dependabot alerts in the readest monorepo (pnpm-workspace overrides, where config lives, tauri-plugins is separate)"
metadata: 
  node_type: memory
  type: reference
  originSessionId: c61e7dd2-4033-4bd1-8f32-22056e4ef322
  modified: 2026-08-05T15:27:02.648Z
---

Fixing transitive npm Dependabot security alerts (manifest `pnpm-lock.yaml`).

**Where pnpm config lives (non-obvious):** the MAIN monorepo's `overrides`,
`patchedDependencies`, `onlyBuiltDependencies`, `allowBuilds` are in
**`pnpm-workspace.yaml`** (newer pnpm style) — NOT the root `package.json`
(root `package.json` has no `pnpm` section). The root `pnpm-lock.yaml` is what
Dependabot scans; alerts report manifest `pnpm-lock.yaml` = this root lockfile.

**`packages/tauri-plugins` is a SEPARATE project**, not part of the main pnpm
workspace. It's a git submodule (`tauri-plugins-workspace`) with its OWN
`pnpm-lock.yaml` and its own `package.json` `pnpm.overrides` +
`minimumReleaseAge: 4320`. The `minimumReleaseAge` (3-day age gate) applies ONLY
there — the main monorepo has NO age gate, so `^X` specs resolve to the very
latest matching version. Dependabot does not scan the tauri-plugins lockfile.
`pnpm-workspace.yaml` `packages:` = `apps/*`, send-email worker, extensions,
`packages/foliate-js` (NOT tauri-plugins).

**Recipe for a transitive advisory:**
1. Add `pkg: '>=X.Y.Z'` to the `overrides:` block in `pnpm-workspace.yaml`
   (forces all transitive instances up). For risky 0.x packages, BOUND it like
   the existing `vite: '>=7.3.2 <8'` (e.g. `esbuild: '>=0.28.1 <0.29'`).
2. For packages that are also DIRECT deps, bump the spec in
   `apps/readest-app/package.json` too (e.g. the vitest family:
   `vitest`, `@vitest/browser-playwright`, `@vitest/browser-webdriverio`,
   `@vitest/coverage-v8` — move in lockstep).
3. `pnpm install`, then `grep -oE "pkg@[0-9.]+" pnpm-lock.yaml | sort -u` to
   confirm no vulnerable versions remain.
4. Verify: `pnpm test` + `pnpm lint` + `pnpm build-web` (the last exercises
   esbuild in the OpenNext/Cloudflare bundle path).

**2026-07-26 sweep — MERGED PR #5335 (a9e50e284):** cleared 32 of 36 open alerts.
next 16.2.6->16.2.11, react/react-dom 19.2.5->19.2.8, react-server-dom-webpack 19.2.8,
vitest family ^4.1.10, sharp 0.34.5->0.35.3, brace-expansion 1.1.16/2.1.2/5.0.8,
fast-uri 3.1.4, shell-quote 1.10.0, js-yaml 4.3.0, body-parser 2.3.0, protobufjs 7.6.5,
dompurify 3.4.12, postcss 8.5.18.

**2026-08-05 sweep — MERGED PR #5518 (e9ee43e88):** cleared all 13 open npm alerts. undici 7.28.0->7.29.0,
brace-expansion 1.1.18/2.1.4/5.0.9, fast-uri 3.1.5, postcss 8.5.18->8.5.25 (exact pin ->
`'>=8.5.23 <9'`), and a NEW `ip-address: '>=10.3.1 <11'` (10.2.0->10.4.0). `ip-address`
enters via `socks@2.8.9` (`^10.1.1`) under the wdio/puppeteer proxy-agent chain, so the
override lands inside the parent's own range. Whole sweep is lockfile+workspace only, no
source changes; only extra churn was `nanoid` 3.3.12->3.3.17 (postcss's own dep) plus
peer-hash rewrites of postcss consumers.

**Version-keyed overrides (multi-major transitive pins):** when several majors of one
package coexist and each has its own patched release, use pnpm's `<pkg>@<range>` selector
keys instead of one flat pin — a flat `brace-expansion: '>=5.0.8'` would force 5.x onto
`minimatch@3` which declares `^1.1.7`. Done 2026-07-26:
```yaml
  'brace-expansion@1': '>=1.1.16 <2'
  'brace-expansion@2': '>=2.1.2 <3'
  'brace-expansion@5': '>=5.0.8 <6'
```
**Always bound `>=X` overrides with `<nextMajor` when a newer major exists on npm.** The
lockfile makes existing pins look safe (an already-locked version that still satisfies
`>=X` is kept), but a *raised* floor forces re-resolution to the highest match — e.g.
`js-yaml: '>=4.3.0'` would have jumped to 5.x. Bounded it to `'>=4.3.0 <5'`.

**Lockstep bumps:** `react-server-dom-webpack@19.2.8` peers on `react`/`react-dom`
`^19.2.8`, so it drags react + react-dom with it. `next` is an exact pin in
`apps/readest-app/package.json` (not an override). The vitest family
(`vitest`, `@vitest/browser-playwright`, `@vitest/browser-webdriverio`,
`@vitest/coverage-v8`) still moves together.

**Verify the DEPLOY build, not just `build-web`:** `pnpm build-web` is turbopack and skips
Next's page-export type check. The Cloudflare path is
`pnpm patch-build-webpack && NEXT_PUBLIC_APP_PLATFORM=web opennextjs-cloudflare build && pnpm restore-build-original`.
Running it on 2026-07-26 surfaced a break that predated the bump — see
[[nextjs-page-export-webpack-only-check]].

**Unfixable alerts (still true 2026-08-05):** `@ai-sdk/provider-utils` (#236) has no patched
release for the 3.x line and 3.0.25 is exact-pinned in `patchedDependencies`. The 3.x copy
enters via `@assistant-ui/react-ai-sdk@1.1.21` (exact pin) -> `@ai-sdk/react@2` -> `ai@5`;
killing it needs `@assistant-ui/react-ai-sdk@1.4.x`, which requires `ai@^7` +
`@ai-sdk/react@^4` while the app depends directly on `@ai-sdk/react ^3.0.49` — a framework
migration, not a security bump. Cargo.lock alerts #12 glib 0.18.5 (gtk-rs 0.18 stack under
webkit2gtk/wry), #94/#95 nix 0.19.1 (via third-party `tauri-plugin-device-info` ->
`battery`), #173 rand 0.7.3 (via `kuchikiki@0.8.8-speedreader` -> `selectors@0.24` ->
`phf_generator@0.8`) are all transitive through crates we do not control. Verify dependents
by parsing `[[package]]` blocks in the root `Cargo.lock` (NOT `src-tauri/Cargo.lock` — the
workspace lockfile lives at the monorepo root).

**Override applicability:** an override forces a transitive version regardless
of the parent's declared range ONLY when the package is a regular dep (no peer
warning). esbuild is a regular dep of vite; vite 7.3.x pins esbuild `^0.27.0`
but esbuild 0.28.x is API-compatible for vite's usage (0.28 changelog = install
integrity + minifier/codegen fixes). Verified via PR #4618 (alerts #238/#239
esbuild→0.28.1, #240 @vitest/browser→4.1.9).
