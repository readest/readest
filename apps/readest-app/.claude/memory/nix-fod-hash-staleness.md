---
name: nix-fod-hash-staleness
description: "Nix build on main breaks whenever pnpm-lock.yaml changes without bumping pnpmDeps.hash in nix/package.nix — FOD reuses stale cached store, fails with ERR_PNPM_NO_OFFLINE_TARBALL"
metadata: 
  node_type: memory
  type: project
  originSessionId: e5feeb2c-20a6-4427-9fd9-3f6031c2f801
  modified: 2026-08-18T19:41:46.585Z
---

`nix/package.nix` (added #5605) pins three fixed-output hashes: `pnpmDeps.hash`, `tursoPluginDeps.hash`, `cargoHash`. Any PR that changes `pnpm-lock.yaml` (resp. plugin lockfile / `Cargo.lock`) without bumping the matching hash breaks the `Build with Nix` workflow (`nix-build.yml`) — which runs ONLY on push to main, so it always breaks post-merge. First hit: #5778 Dependabot bump (run 32170666051, 2026-08-18, missing `@assistant-ui/react-0.11.58.tgz`); package.nix's own comment says it also went stale pre-merge after #5754/#5764.

**Why:** the failure is NOT a hash mismatch — an un-bumped hash means Nix substitutes the OLD dep store from cachix (hash still "matches"), then pnpm's offline install can't find newly added tarballs → `ERR_PNPM_NO_OFFLINE_TARBALL` late in the build. Inherent to Nix FODs; same model as nixpkgs npmDepsHash/cargoHash.

**How to apply:** MERGED #5779 (2026-08-19): fixed the #5778 staleness (hash `sha256-0gMtrfX+s3cOPGrl1cmmAMwvk0jMVezm3j+oJqvlhb8=`) and added `.github/workflows/nix-deps-check.yml`: on PRs touching pnpm-lock.yaml/Cargo.lock/nix files it builds `.#default.pnpmDeps .#default.tursoPluginDeps .#default.cargoDeps` WITHOUT the readest cachix substituter, so a stale hash fails pre-merge printing `specified:`/`got:`. That run is also THE way to compute a new hash — no local nix/Linux/docker needed (user explicitly banned docker AND OrbStack for this; do not reach for either): push the PR, read `got:` from the failing check, commit it. You do NOT need to blank the hash first; the stale value mismatches naturally once substitution is off. Un-bumped hash on main fails differently (cachix serves old store → offline-tarball error, no `got:` printed). cargoHash could be eliminated entirely via `rustPlatform.importCargoLock` (Cargo.lock has 1 git dep: readest/localsend); pnpm has no official no-hash fetcher. Related: [[build-ci-recipes]].
