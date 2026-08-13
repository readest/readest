---
name: nix-packaging-pr-5605
description: "PR #5605 nix packaging review — fileset gitignore bypass + unpinned actions blockers; readest is ALREADY in nixpkgs so users need no cachix trust"
metadata: 
  node_type: memory
  type: project
  originSessionId: 7e3e16e0-fb14-479e-be1b-4a6e4fd66337
  modified: 2026-08-11T16:41:34.382Z
---

PR #5605 (dastarruer, fork `dastarruer/readest`, branch `feat/package-for-nix`) moves the flake `ops/` → repo root, adds `nix/package.nix`, `nix-build.yml` (cachix push on push+PR), `nix-update-inputs.yml` (weekly update-flake-lock), and a README section telling users to use the flake. Reviewed 2026-08-12 at head `5953d70d2`; full findings posted as https://github.com/readest/readest/pull/5605#issuecomment-5256058458

**Blockers (recheck on next push):**
1. `src = lib.fileset.unions [ ../apps/readest-app ... ]` — fileset is a path allowlist, does NOT honor `.gitignore`. Sweeps `.env.*.local`, `keystore.properties` (CI writes `SENTRY_AUTH_TOKEN` into `.env.local` in nightly/release), `.claude/plans/`. Fix = `lib.fileset.intersection (lib.fileset.gitTracked ../.) (...)`; verify vs `self.submodules = true`.
2. Six unpinned action refs incl. `DeterminateSystems/update-flake-lock@main` with `contents: write` + `id-token: write`. Repo convention is 100% SHA-pinned; Scorecard will flag.

Other confirmed: `CACHIX_AUTH_TOKEN` (exists in repo secrets) reachable from `pull_request` — push-capable token can publish a NAR for ANY store path = cache poisoning; darwin eval error (`mkCommonShell` strict destructure gets unexpected `ios` arg, `devShells.ios` dropped; ubuntu-only CI can't catch); no `meta.platforms`; `GITHUB_TOKEN`-opened update PRs trigger no CI; duplicate flake-check/build jobs with two different Nix installers; vestigial `nix-update-script` passthru; leftover "to be dropped" commit.

**Key context:** readest is ALREADY packaged in nixpkgs (`pkgs/by-name/re/readest`, 0.11.18, linux-only, same author upstreamed near-identical expression). So the recommended model = README points users at `nixpkgs#readest` (Hydra/cache.nixos.org, zero new trust); cachix cache is CI-only; never ask users to add our cachix key to `trusted-public-keys` (a trusted cache key vouches for ANY store path, not just readest's). Cachix push policy = separate push-on-main workflow, explicit `cachix push readest ./result`, never the watch hook (would also publish unfree android-sdk / source paths).

Related: [[localsend-integration]] for the other embedded-dependency supply-chain work.
