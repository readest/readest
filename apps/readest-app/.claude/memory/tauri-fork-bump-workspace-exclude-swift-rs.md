---
name: tauri-fork-bump-workspace-exclude-swift-rs
description: "Bumping the packages/tauri fork past upstream #15412 broke `cargo update`; root workspace must EXCLUDE the fork, vendored swift-rs is relabelled 1.0.8, tao patch dropped, rust-version 1.90 (2026-09-06)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 463c36b3-0264-46b4-96b0-f0fe22ea4ce7
  modified: 2026-09-05T18:58:43.971Z
---

Session 2026-09-06 on `dev`: `packages/tauri` submodule bumped 6914700e0 -> 79e17d98a
(fork branch `readest`, 3 commits on upstream: unlisten guard, Romanian NSIS,
iOS home indicator). Upstream ba3490b3e "Use workspace dependency management
(#15412)" switched every fork crate to `{ workspace = true }` deps, and
9e9a54dea moved tauri to `swift-rs = "1.0.8"`, tauri-runtime-wry to
`tao 0.37` / `wry 0.56`, MSRV 1.90.

**Why:** three separate traps, each silent or misleading.

1. Root `Cargo.toml` listed `packages/tauri/crates/tauri` as a workspace
   MEMBER, so its `workspace = true` keys resolved against Readest's root
   (`tauri-macros not found in workspace.dependencies`). Cargo caches found
   workspace roots (`ws_roots`) and ANY path dep under the repo root that is
   not in `exclude` inherits from Readest's root, member or not. Fix = drop the
   member AND add `packages/tauri` to `exclude`; `[patch.crates-io]` still
   reaches it. Do NOT mirror the fork's `[workspace.dependencies]` into root.
2. `cargo update` then SUCCEEDED but printed `patch tauri ... was not used`
   and locked crates.io tauri 2.11.3 (older than the fork). Cause: cargo
   prefers `[patch]` candidates (`prefer_patch_deps`), so tauri-plugin-log's
   `swift-rs ^1` grabs the vendored 1.0.7, the fork's `^1.0.8` cannot unify,
   and the resolver backs off to registry tauri instead of the patch.
   Fix = relabel `packages/swift-rs` as `version = "1.0.8"` (code stays
   1.0.7 + the Readest `--triple`/`--sdk` build.rs patch; lib API used by
   tauri's ios.rs is unchanged). Upstream swift-rs 1.0.8 (2026-08-17) only
   uses `--triple` on Xcode 27 and keeps the legacy path on Xcode 26.x, which
   is what Readest found broken, so the vendored copy stays for now.
3. `tao = { path = "packages/tao" }` (0.35.3 + 2 iOS scene fixes) can never
   match `^0.37` again, so the patch line was REMOVED in #6081. CORRECTION
   (verified against tao-0.37.0 sources 2026-09-06): upstream ports only ONE
   half. `f2163508` (#1245, velocitysystems) = the use-after-free fix
   (`Retained::autorelease_ptr`). `a3ff3f03` (Lucas Nogueira) passes the
   connecting session's ROLE through but STILL calls
   `setDelegateClass(TaoSceneDelegate)` for EVERY role. The fork's 419f5bba
   returns a name-less config WITHOUT a delegate override for non-window roles
   so UIKit takes the Info.plist manifest entry; with plain 0.37.0 a CarPlay
   session gets TaoSceneDelegate -> NSGenericException "does not implement
   CarPlay template application lifecycle methods" on connect (fork comment,
   real device). No upstream PR from chrox/readest exists; the fork patch does
   NOT apply cleanly onto 0.37.0 (context moved). VERIFIED 2026-09-06 on the
   iOS 18.5 simulator (iPhone 16 Pro, `pnpm dev-ios-sim` of main 34e4ebeeb,
   binary contains tao-0.37.0): app launches and renders; CarPlay display
   attached via Simulator I/O > External Displays > CarPlay; Readest opened on
   CarPlay and showed the CPNowPlaying template with the current book, process
   alive, no crash report, no NSGenericException. So upstream 0.37.0 is FINE
   for CarPlay despite the TaoSceneDelegate override; the theoretical concern
   above did NOT materialize. `packages/tao` submodule REMOVED in local dev
   commit a362ac598 (2026-09-06, `git submodule deinit` + `git rm`, workflow
   comment updated; NOT pushed). Not yet checked: iOS 26.3 sim, real device.

Also: `rust-version` bumped 1.77.2 -> 1.90 in root `[workspace.package]` and
`src-tauri/Cargo.toml` (user request). MSRV-aware fallback is NOT active with
`resolver = "2"`, so this did not affect resolution. In-repo plugin crates
(native-bridge 1.88, native-tts 1.77.2) untouched; turso/webview-upgrade are
submodules.

Rebase onto origin/main (655c72ad5, #6074 Linux CEF) later the same day:
main had already dropped BOTH fork members and the `tauri-plugin-fs` patch
(crates.io fs 2.5.2 now, so persisted-scope 2.3.8 resolves), but pinned
`packages/tauri` to 61a041281 (`feat/cef-feature-stub`, OLD base) because the
app crate declares `cef = ["tauri/cef"]`. Without that stub cargo fails:
"package `Readest` depends on `tauri` with feature `cef` but `tauri` does not
have that feature". chrox: "Use the latest readest/tauri:readest branch", so
the stub commit 61a041281 was cherry-picked onto origin/readest (79e17d98a)
= 3156d92b7 and PUSHED to origin/readest on 2026-09-06 (chrox: "add the cef
stub if it's necessary"); the superproject gitlink can now be committed. `feat/cef-feature-stub` was
then force-with-lease'd to the SAME 3156d92b7 (chrox asked); main's pinned
61a041281 then sat on NO fork branch and PR #6080's `nix_flake_check` FAILED
2 min later ("Cannot find Git revision 61a04128 in ref refs/heads/readest"):
nix fetches a submodule rev BY SHA, which GitHub serves only while some ref
reaches it. Repaired with tag `cef-stub-old-base` -> 61a041281 on the fork
and a job rerun. RULE: never force-push away a fork commit a readest
superproject ref still pins; tag it first. `.gitmodules` pins no branch. CLAUDE.md: Linux CEF needs Rust >= 1.95
(git feat/cef), unrelated to the 1.90 MSRV here.

**How to apply:**
- After ANY fork bump, read the whole `cargo update` output: `patch ... was
  not used` is a warning, not an error, and means the fork was silently
  dropped. `cargo metadata | jq` the `tauri` source to confirm PATH.
- Diagnose resolver picks with
  `CARGO_LOG=cargo::core::resolver=trace cargo update --dry-run 2>log` and grep
  `conflict_cache` lines; forcing `tauri = "=x.y.z"` makes cargo name the
  conflict.
- iOS build NOT verified this session (local Xcode 26.3). First iOS build must
  confirm swift-rs still cross-compiles; if it fails on Xcode 27, port the
  Readest patch onto upstream 1.0.8 (gate `use_triple` on cross_compiling only,
  `env_remove("SDKROOT")`, `<triple>[-simulator]/<config>` search path).
- The leftover `packages/tauri-plugins/` checkout (submodule removed on main
  by #6074, clean, nothing unpushed) is untracked junk; `rm -rf` it.
- `Cargo.cef.lock` (Linux CEF build, #6074/#6080) is a SECOND committed lock;
  `scripts/tauri.mjs` swaps it in as Cargo.lock with NO `--locked`, so a stale
  one silently re-resolves on the release runner. Regenerate with the same
  swap + `cargo metadata --config .cargo/cef.toml` from src-tauri (MINIMAL
  resolve); never bare `cargo update` there, the feat/cef plugin patches are
  version-pinned and a newer crates.io release silently drops them.
- Cargo.lock changed a lot (fork crates' dev-deps left the lock); expect the
  Nix FOD hash to need refreshing, see [[nix-fod-hash-staleness]].

Outcome: shipped as PR #6081 "chore: bump tauri to version 2.11.5" (head on the
`chrox/readest-app` fork, squash-merged ee86510cc 2026-09-05T20:32Z) after two
CI fixes: cargoHash + pnpmDeps hash bumps and the `as_chunks` clippy rewrite in
epub_parser.rs. Main then took #6083 (nix Linux package on CEF). The temporary
fork tag `cef-stub-old-base` was DELETED once main pinned 3156d92b7; the
leftover `packages/tauri-plugins/` dir is gone. STILL OPEN: `packages/tao`
submodule is registered in .gitmodules but unused (remove in a follow-up PR);
iOS build with the relabelled swift-rs + upstream tao 0.37 not yet verified.

Sim recipe that worked (2026-09-06): boot `xcrun simctl boot <udid>` + `open -a
Simulator` FIRST, `pnpm dev-ios-sim` (Next export + cargo sim build + xcodebuild
+ `simctl install booted`, ~12 min; the install is the LAST step, so check the
installed binary mtime before launching or you test the stale July app),
`xcrun simctl launch booted com.bilingify.readest`, log via `xcrun simctl spawn
booted log stream --predicate 'process == "Readest" OR eventMessage CONTAINS
"Readest"'`. CarPlay: `osascript -e 'tell application "System Events" to tell
process "Simulator" to click menu item "CarPlay" of menu "External Displays" of
menu item "External Displays" of menu "I/O" of menu bar 1'` WORKS from this
session (older memory said TCC blocked osascript; not the case now); computer-
use screenshots hide menus and non-allowlisted windows, and its clicks on the
CarPlay window did not register as touches; `System Events click at` needs the
window raised (AXRaise errored -25204). chrox tapped the CarPlay icon by hand.
`xcrun simctl io booted screenshot --display external` captures the CarPlay
framebuffer (800x480).
