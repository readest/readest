---
name: turbopack-build-cache-oom-docker-standalone
description: "Turbopack build-cache OOM that froze the Mac, and the gated Docker standalone image (PR"
metadata: 
  node_type: memory
  type: project
  originSessionId: 41c10f07-ba55-451b-89b4-7e13a5fa3087
---

PR #4619 (merged, squash 6514d4aa5): web Docker production image → Next.js standalone, plus disabling the experimental Turbopack build cache.

**RAM-meltdown root cause (cost a force-reboot to find).** `experimental.turbopackFileSystemCacheForBuild: true` (beta) is the culprit, NOT the standalone config and NOT the compiler. When a `pnpm build-web` (Turbopack production build) is interrupted mid-compile (e.g. SIGTERM), it leaves a **partial** build cache in `.next/`. The next build on top of that poisoned cache fans out to ~42 worker processes and drives swap to ~18 GB (macOS auto-grows the swapfile) on a 16 GB M1 Pro → thrash → freeze. A *clean* Turbopack `next build` of readest peaks at only ~6.5 GB and fits fine. **Proven by A/B from a cold `rm -rf .next`:** both `output: undefined` and `output: 'standalone'` complete in ~48 s at ~6.5 GB with flat swap; only the warm/partial-cache run exploded.
- Fixes: removed `turbopackFileSystemCacheForBuild` (kept `turbopackFileSystemCacheForDev`); removed the `pull-request.yml` step that cached `.next/cache` for it (now dead).
- Rule: **after interrupting a local build, `rm -rf .next` before retrying.** Never run an unbounded `pnpm build-web` on the dev machine.

**Watchdog gotcha.** A host-side memory watchdog that polls `ps`/recursive-`pgrep` over the build tree STARVES under thrash (its own syscalls block on paging) and can't fire the kill. Working pattern: sample every 1 s, decision FIRST using only cheap `sysctl vm.swapusage` + `vm_stat`, kill EARLY (avail < 3.8 GB or swap_used > 2.5 GB), `nice -n 19` the build. Even so, prefer Docker (capped VM RAM) or CI over local full builds.

**Docker standalone, gated.** `output: 'standalone'` + `outputFileTracingRoot` (monorepo root) are gated on a `BUILD_STANDALONE` env flag set ONLY in the `Dockerfile` build stage (`ENV BUILD_STANDALONE=true` before `pnpm build-web`). Every other path keeps original output: Tauri `export`, local `build-web`/dev (`undefined`), and the Cloudflare/OpenNext deploy (`undefined` in config, but OpenNext forces standalone via `setStandaloneBuildMode`→`NEXT_PRIVATE_STANDALONE`, so idempotent). `production-stage` copies `.next/standalone` (→ `apps/readest-app/server.js` + hoisted `node_modules`) + `.next/static` + `public`, runs non-root `node`, entrypoint `node apps/readest-app/server.js`. `docker-image.yml` builds it on merge only (not PRs), so verify the gate locally.

**Tauri CI red herring.** `build_tauri_app`'s `run tauri tests` step (`scripts/test-tauri.sh`) uses `next dev` + `tauri dev --features webdriver` — both config-output-independent, so next.config `output`/tracing changes can't affect it. Normally 2–3 min (Swatinem/rust-cache restores crates); a cold cache makes it 15–20 min of "Compiling …" that looks stuck but isn't. See [[r2-rclone-createbucket-403]] for other build/deploy CI notes.
