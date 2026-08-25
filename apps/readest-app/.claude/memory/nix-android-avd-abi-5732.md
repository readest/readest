---
name: nix-android-avd-abi-5732
description: "#5732 nix android devShell asked avdmanager for an x86_64 image on aarch64-darwin; fix derives one androidAbi from hostPlatform.isAarch64 for both the SDK attrs and the -k path; PR #5850"
metadata: 
  node_type: memory
  type: project
  originSessionId: d69807b0-d641-4984-9fa7-648e5af93ff7
  modified: 2026-08-24T16:11:12.419Z
---

Issue #5732 (CodeRabbit follow-up that dastarruer deferred out of #5605): the `flake.nix` android devShell installed `system-images-android-34-google-apis-arm64-v8a` (+playstore) on `aarch64-darwin` and the `x86-64` pair on `x86_64-linux`, but the shellHook hardcoded `avdmanager create avd -k "system-images;android-34;google_apis;x86_64"`, so AVD creation failed on every Apple Silicon `nix develop .#android` (that image is never installed there and could not run on the emulator anyway).

Fix (PR #5850 MERGED 2026-08-25, worktree removed; branch commit `9b1e615b2`): one `androidAbi = if pkgs.stdenv.hostPlatform.isAarch64 then "arm64-v8a" else "x86_64"` in the flake `let`; SDK attrs become `sdkPkgs."system-images-android-34-google-apis-${androidImageSuffix}"` with `androidImageSuffix = lib.replaceStrings ["_"] ["-"] androidAbi` (android-nixpkgs spells the ABI `x86-64` in attribute names while the SDK package path uses `x86_64`); the `-k` path interpolates `${androidAbi}`. Linux output is byte-identical to before.

**Why:** the package list and the `-k` literal were two independent hardcodes and the darwin branch was authored without ever being run. `isAarch64` (not `system == "aarch64-darwin"`) so a future `aarch64-linux`/`x86_64-darwin` entry picks the right ABI too.

**How to apply:**
- `nix` is NOT installed on this Mac and docker/OrbStack are banned (see [[nix-fod-hash-staleness]]), so the only evaluation check is the PR job `nix_flake_check` (`nix flake check --all-systems -L` in `.github/workflows/pull-request.yml`), which evaluates `devShells.aarch64-darwin.android`. `nix-deps-check.yml` also fires on `flake.nix` changes but only builds the FOD deps.
- Parse + format check without nix: `cargo install nixpkgs-fmt --root $CLAUDE_JOB_DIR/tmp/cargo` (~1 min, no global side effects), then `nixpkgs-fmt --check flake.nix`. nixpkgs-fmt is the flake's declared `formatter`.
- android-nixpkgs attribute names and the SDK `path=` of an image are verifiable offline via the GitHub git-trees API at the rev pinned in `flake.lock` (`channels/stable/<attr>.xml`; the contents API truncates that directory).
- PR #5850 `nix_flake_check` PASSED (run 32749038007, 2026-08-25), so the change evaluates on both systems. End-to-end (`nix develop .#android` creating the `readest-android` AVD on an M-series Mac) is UNVERIFIED; asked dastarruer on the PR. Related: [[build-ci-recipes]].
