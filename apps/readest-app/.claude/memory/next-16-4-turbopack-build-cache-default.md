---
name: next-16-4-turbopack-build-cache-default
description: "Next 16.4 turns turbopackFileSystemCacheForBuild on by default; Vercel's warm cache then panicked/OOMed the web build after #7050"
metadata:
  node_type: memory
  type: project
  originSessionId: bf738e1c-9c52-449f-bb92-2cf3269cf7e6
  modified: 2026-10-25T10:26:36.273Z
---

Next 16.4 (bumped in #7032) defaults `experimental.turbopackFileSystemCacheForBuild` to true. `next.config.mjs` had relied on the old default being off. Vercel restores `.next/cache`, so production builds started warm. On 2026-10-25, #7050's merge (664b7dc34) panicked (`get_disjoint_mut was called with equal keys`), then the redeploy OOMed during "Running TypeScript".

Fixed by #7082 (merged 2026-10-25), which sets the flag to false explicitly. The next production deploy was Ready.

**Why:** a cold local build passes, so the bug only shows on a warm cache. Local repro: build the parent commit, then the failing commit, without `rm -rf .next`.

**How to apply:** after any Next bump, diff `node_modules/next/dist/server/config-shared.js` defaults against the flags `next.config.mjs` relies on implicitly. Related: [[build-ci-recipes]].
