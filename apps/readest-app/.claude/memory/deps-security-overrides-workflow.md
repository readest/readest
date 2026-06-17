---
name: deps-security-overrides-workflow
description: "How to fix transitive npm Dependabot alerts in the readest monorepo (pnpm-workspace overrides, where config lives, tauri-plugins is separate)"
metadata: 
  node_type: memory
  type: reference
  originSessionId: c61e7dd2-4033-4bd1-8f32-22056e4ef322
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

**Override applicability:** an override forces a transitive version regardless
of the parent's declared range ONLY when the package is a regular dep (no peer
warning). esbuild is a regular dep of vite; vite 7.3.x pins esbuild `^0.27.0`
but esbuild 0.28.x is API-compatible for vite's usage (0.28 changelog = install
integrity + minifier/codegen fixes). Verified via PR #4618 (alerts #238/#239
esbuild→0.28.1, #240 @vitest/browser→4.1.9).
