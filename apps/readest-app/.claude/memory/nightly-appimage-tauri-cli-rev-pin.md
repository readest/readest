---
name: nightly-appimage-tauri-cli-rev-pin
description: Nightly/release Linux legs hang in AppImage bundling whenever the tauri feat/truly-portable-appimage branch tip changes; both the CLI rev AND quick-sharun.sh must be pinned
metadata: 
  node_type: memory
  type: project
  originSessionId: 32ce6dd7-4371-4784-8d61-e9cc7fdb0131
  modified: 2026-08-02T07:47:07.051Z
---

The Linux legs of `nightly.yml` / `release.yml` bundle AppImages with a **tauri CLI fork** (`tauri-apps/tauri` branch `feat/truly-portable-appimage`) whose bundler shells out to `quick-sharun.sh` from `pkgforge-dev/Anylinux-AppImages@main`. **Two moving upstream refs, both must be pinned** or the build hangs.

**Failure signature (#4906, recurred 2026-07-31 / 2026-08-01, PR #5433 MERGED 2026-08-02 as `33d9a4cd3`; the dispatched verification run 30737908133 was still mid-flight at merge, so confirm the Linux legs went green there or on the next cron before trusting the pin):** `build desktop bundles` burns its full 45min step timeout; last log line is ` Downloading https://raw.githubusercontent.com/pkgforge-dev/Anylinux-AppImages/refs/heads/main/useful-tools/quick-sharun.sh`, then nothing, then orphan `cargo-tauri` / `quick-sharun.sh` / `xvfb-run` / `Xvfb` / `MiniBrowser`. The script's output is invisible either way: the bundler uses `output_ok()`, which buffers, so successful runs print nothing from sharun either.

**Why the 2026-07-31 recurrence:** the fork tip moved `16262696` -> `72e660b2`, and that rewrite of `crates/tauri-bundler/src/bundle/linux/appimage/sharun.rs` **dropped the `if !quick_sharun.exists()` guard** — it now re-downloads the script on EVERY build, silently overwriting the copy the `pin quick-sharun.sh` step seeds into `${XDG_CACHE_HOME:-$HOME/.cache}/tauri/`. The script pin alone is therefore worthless against newer revs. Fix = `cargo install tauri-cli --git ... --rev 162626969b382d52faebdf6c7264460bd9a47d1f` (was `--branch feat/truly-portable-appimage`). That rev is the **merge base** of the branch tip (`gh api repos/tauri-apps/tauri/compare/A...B --jq .merge_base_commit.sha`), i.e. a real ancestor, so it is not a GC-able dangling commit; a direct `git fetch --depth=1 origin <sha>` confirms fetchability.

Same rewrite also changed the sharun invocation (`quick-sharun.sh <bins> <lib_dir>` instead of `<main_binary> <bins>`, no more `DESKTOP`/`ICON` env, AppDir layout `bin/`+`lib/` instead of `usr/`) and moved strace collection from a `$(...)` subshell to an inline call. So **never mix a new CLI rev with the old pinned script** — bump the rev and the script SHA together, and verify with a real Linux run.

**Blast radius when a Linux leg dies:** the per-leg fragment design holds (other platforms still publish), but `assemble-manifest` still promotes `nightly/latest.json` **without any `linux-*` platform keys**, so Linux nightly users silently get no update. Check with `curl -s https://download.readest.com/nightly/latest.json | jq '.platforms|keys'`.

**Verifying a workflow-file fix without waiting for the 22:00 UTC cron:** every `nightly.yml` job does `actions/checkout` with `ref: main`, so `gh workflow run nightly.yml --ref <fix-branch>` runs the **fixed workflow file** against **main's source** — a true end-to-end test. It does publish a real nightly to R2 and promote `latest.json` (which is also how you restore missing platform entries immediately). `release.yml` carries the same two AppImage steps and must be kept in sync ([[ci-pr-delivery-and-push]], [[verify-format-check-gate]]).
