---
name: crosspoint-simulator-setup
description: "Where the CrossPoint firmware + desktop simulator live on this Mac, how to build/run, and the two local source patches macOS 15 needs"
metadata: 
  node_type: memory
  type: project
  originSessionId: 6b8d3a47-abd0-4891-bb93-5e24bcc3b617
  modified: 2026-09-04T18:00:47.007Z
---

Set up 2026-09-05. Checkouts side by side under `~/dev/crosspoint/`:
- `crosspoint-reader/` — firmware, SHALLOW clone (`--depth 1`, master 9d2f234 of 2026-09-04) with `freeink-sdk` submodule initialized. `git fetch --unshallow` if history is needed.
- `crosspoint-simulator/` — `crosspoint-reader/crosspoint-simulator` (c55f168, 2026-09-02), referenced as `simulator=symlink://../crosspoint-simulator`.

Build/run from `~/dev/crosspoint/crosspoint-reader`:
```
pio run -e simulator -t run_simulator      # X4 profile; also simulator_x3, simulator_x4_pro
```
PlatformIO 6.1.19 is from Homebrew (`brew install platformio`), native platform 1.2.1. Simulator envs live in the gitignored `platformio.local.ini` (pulled in via `extra_configs`), copied from the simulator's `sample-platformio-macos.ini`. Simulated SD card = `./fs_/` (books in `fs_/books/`, caches in `fs_/.crosspoint/`). Web UI on http://127.0.0.1:8080 while File Transfer is on. Headless QA: `CROSSPOINT_SIM_INPUT_SCRIPT='6000:QUIT' CROSSPOINT_SIM_SCREENSHOTS='5000:./qa-artifacts/home.bmp' .pio/build/simulator/program`.

**Two local patches to tracked firmware files were required on macOS 15.6 / Xcode 17 SDK 26.2 (uncommitted, show in `git diff`):**
1. `src/activities/home/HomeActivity.h`: replace `struct RecentBook;` forward decl with `#include "RecentBooksStore.h"`. libc++ instantiates `~std::vector<RecentBook>` in the inline ctor and rejects the incomplete type; `-fno-exceptions` does NOT help.
2. `lib/Epub/Epub/css/CssParser.cpp` `tryParseNumber`: `#if defined(SIMULATOR) && defined(__APPLE__)` + `if constexpr (is_floating_point_v<T>)` strtod fallback, with the `std::from_chars` call in the ELSE branch (an early return alone still instantiates it). Floating-point `std::from_chars` is macOS 26+ only.

**Why:** the simulator lags firmware master and its README says nothing about either; both patches are upstream-worthy (portability), neither touches device builds.

**How to apply:** after `git pull` in the firmware, re-check these two files still carry the patches (or the fix landed upstream) before rebuilding. See [[crosspoint-integration-feasibility-2026-09]] for what the simulator is for.

**State as of 2026-09-05 (paused mid-task):** the firmware checkout is on branch `sim/feat-sd-plugins`
(PR #3114 + the two mac fixes cherry-picked) and its simulator build is BROKEN pending shims
(`ContentProtection.h` not found is the first error). `develop` builds and runs. The simulator
checkout carries an uncommitted `HalStorage::readFileToString` patch. Full TODO lives in
`apps/readest-app/.claude/plans/2026-09-05-crosspoint-readest-plugin.md`; Readest work goes in the
worktree `~/dev/readest-feat-crosspoint-plugin` (branch `feat/crosspoint-plugin`).
