---
name: nix-fod-hash-staleness
description: "Nix build on main breaks whenever pnpm-lock.yaml changes without bumping pnpmDeps.hash in nix/package.nix — FOD reuses stale cached store, fails with ERR_PNPM_NO_OFFLINE_TARBALL"
metadata: 
  node_type: memory
  type: project
  originSessionId: e5feeb2c-20a6-4427-9fd9-3f6031c2f801
  modified: 2026-08-18T18:33:18.099Z
---

`nix/package.nix` (added #5605) pins three fixed-output hashes: `pnpmDeps.hash`, `tursoPluginDeps.hash`, `cargoHash`. Any PR that changes `pnpm-lock.yaml` (resp. plugin lockfile / `Cargo.lock`) without bumping the matching hash breaks the `Build with Nix` workflow (`nix-build.yml`) — which runs ONLY on push to main, so it always breaks post-merge. First hit: #5778 Dependabot bump (run 32170666051, 2026-08-18, missing `@assistant-ui/react-0.11.58.tgz`); package.nix's own comment says it also went stale pre-merge after #5754/#5764.

**Why:** the failure is NOT a hash mismatch — an un-bumped hash means Nix substitutes the OLD dep store from cachix (hash still "matches"), then pnpm's offline install can't find newly added tarballs → `ERR_PNPM_NO_OFFLINE_TARBALL` late in the build. Inherent to Nix FODs; same model as nixpkgs npmDepsHash/cargoHash.

**How to apply:** to fix, set the stale hash to `""`, `nix build` on Linux (packages.default is x86_64-linux only — cannot compute on this macOS machine without a linux builder), copy the `got: sha256-...` value. `nix build --rebuild .#default.pnpmDeps` forces re-fetch and surfaces the correct hash even when the old output is cached. Durable fix discussed: auto-bump workflow on lockfile changes (repo already has `nix-update-inputs.yml` for flake.lock weekly) or a PR lint "lockfile changed ⇒ hash line changed". Related: [[build-ci-recipes]].
