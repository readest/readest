---
name: mas-sandbox-blank-customrootdir
description: MAS sandbox-blank window root-caused 2026-08-19 — customRootDir outside the container throws in loadLibraryBooks and initLibrary() has no .catch()
metadata: 
  node_type: memory
  type: project
  originSessionId: a65b1cda-baa6-4b16-84bd-387688670583
  modified: 2026-08-19T16:18:14.674Z
---

# MAS blank window = customRootDir + unguarded initLibrary (2026-08-19)

**RESOLVED the long-open "MAS sandbox-blank" item from
[[icloud-sync-provider]].** It was never an iCloud, entitlement, container,
or webview-load problem.

## Symptom
App Store build (`Apple Mac OS Application Signing`, `app-sandbox=true`,
v0.12.1 build 20260809.022627) launches, creates its window, writes
`.window-state.json`, and the WKWebView **fully loads** — logs show
`didNavigateWithNavigationDataShared` + `didSameDocumentNavigationForFrameViaJS`
then "page load completed". Window is 100% blank: no header, no sidebar, no
spinner. Same binary unsandboxed (DMG) renders fine. Process is healthy —
`sample` shows the main thread idle in the normal `-[NSApplication run]`
event loop, not hung.

## Root cause chain
1. `settings.json` in the container had `customRootDir` =
   `/Users/chrox/Documents/Readest-Test` (stale, left over from 2026-08-06
   appstore-dev testing; the dir no longer exists).
2. `nativeAppService.init()` swaps `fs.resolvePath` to that root
   (`nativeAppService.ts:665-671`). `init()` itself does NOT touch the disk
   there — `prepareBooksDir()` only calls `getPrefix`, which is pure string
   work. So **init succeeds** and `appService` is non-null.
3. Library page mount → `loadLibraryBooks()` →
   `libraryService.ts:24-26`: `if (!await fs.exists('','Books')) await
   fs.createDir('','Books',true)` → recursive mkdir of
   `/Users/chrox/Documents/Readest-Test/Readest/Books`.
4. Kernel denies the topmost missing component:
   `Sandbox: readest(38614) deny(1) file-write-create /Users/chrox/Documents/Readest-Test`
   → `createDir` throws.
5. `src/app/library/page.tsx:773` calls `initLibrary()` as a **floating
   promise with no `.catch()`**. The throw kills the rest of the function, so
   `setLibrary` / `setLibraryLoaded(true)` / `setLoading(false)` never run and
   the page renders nothing. Unhandled rejection, no user-visible error.

## Confirming experiment (done, verified)
Removed `customRootDir` from
`~/Library/Containers/com.bilingify.readest/Data/Library/Application Support/com.bilingify.readest/settings.json`,
relaunched: the `Readest-Test` deny is gone from the kernel log and the app
renders the full "Start your library" empty state. `localBooksDir` self-heals
— `settingsService.loadSettings` line 165 recomputes it from
`fs.getPrefix('Books')` on every load, so only `customRootDir` needs removing.

## The exact blank-screen line
`page.tsx` early return: `if (!appService || !insets || checkOpenWithBooks ||
checkLastOpenBooks) return <div className='full-height bg-base-200' />;`
Both `check*` flags default to `isTauriAppPlatform()` (libraryStore.ts:76-77)
and are cleared ONLY on `initLibrary`'s success path (lines 743/747). The throw
skipped both setters, so the early return rendered that bare div forever. Web
was immune because both flags start `false` there.

## Hardening: PR #5789 MERGED 2026-08-19
Squash-merged as `4171f45bd` on main. Worktree + local + remote branch all
removed. +144/-24 across 7 files. NOTE: `/ship`'s version-bump + CHANGELOG
steps do NOT apply to this repo (no VERSION file; fix PRs never touch
CHANGELOG) -- repo convention beats the generic skill. Readest squash-merges,
so `git merge-base --is-ancestor <branch-sha> origin/main` says NO after a
merge; verify with the PR's `mergeCommit.oid` and by grepping the merged
content out of `origin/main`, then `git branch -D` (plain `-d` refuses).

**RUNTIME VERIFY STILL PENDING** on a signed sandboxed build. Cheap proxy:
`pnpm tauri dev` with `customRootDir` pointed at an unwritable path
reproduces the same throw unsandboxed and should now render the library plus
a folder-naming toast instead of a blank window.

## Hardening detail
`BaseAppService.isRootDirUsable()` + `unavailableRootDir` (appService.ts,
types/system.ts); `nativeAppService.init()` probes the custom root and records
it WITHOUT reverting the resolver (silent fallback would scatter imports into a
second library); `page.tsx` `.catch()` on both `initLogin`/`initLibrary` that
releases the render gates and toasts, naming the folder when
`unavailableRootDir` is set; `EnvContext` `.catch()`; `environment.ts` now
publishes the service singleton only AFTER `init()` resolves (it used to cache
a half-built service on failure, and never re-ran init). 5 new tests in
`app-service.test.ts`. Full suite 9538 green, lint/format clean. NOT verified
at runtime — needs a signed sandboxed build, or `pnpm tauri dev` with a
deliberately unwritable `customRootDir`.

## i18n TRAP
`pnpm i18n:extract` swept in ~56 keys of PRE-EXISTING drift (audiobook pairing,
TTS queue, Yomitan) across all 33 locales — 1924 insertions for a 2-key change.
Reverted `public/locales/`. Key-as-content means new English strings work with
no locale entry; other locales fall back to English until `/i18n` runs. Always
`git diff --stat public/locales/` after an extract before committing.

## The shipped bug (fixed above; original analysis)
A fresh App Store install is fine (no settings.json ⇒ no `customRootDir`), so
this is not a day-one launch blocker. But **any** unreachable library root
bricks the app into a blank window with no in-app recovery: deleted folder,
unplugged external drive, or a sandbox-denied path. Two fixes worth making:
- `page.tsx:773` — `.catch()` on `initLibrary()`; surface the error and fall
  back to the default root instead of rendering nothing. Same shape of hazard
  exists in `EnvContext.tsx` (`getAppService().then(...)` also has no
  `.catch()`; if `init()` ever throws, `appService` stays `null` forever).
- `libraryService.ts:25` — a failed `createDir` on a custom root should
  degrade to the container default, not propagate.

## MAS-specific hazard (strong code evidence, NOT empirically verified)
There is **no security-scoped bookmark code anywhere** for the custom root —
grep for `bookmark` in `nativeAppService.ts` / `MigrateDataWindow.tsx` returns
nothing. `allowPathsInScopes` and `.persisted-scope` are Tauri's *userspace*
fs_scope / asset_protocol_scope allowlist; they grant nothing at the kernel
level. So a MAS user who picks a custom library folder gets powerbox access
for that session only, and the next launch should hit the same deny → blank
window. iOS does have this (`InPlaceFolderBookmarkStore` in
`NativeBridgePlugin.swift`) for in-place folders, but macOS custom root has no
equivalent. I verified the deny for a *nonexistent* dir; I did not test
relaunch against a still-existing picked folder.

## Debugging recipe that cracked it
- `log` is the **zsh builtin** — must use `/usr/bin/log`, and `log stream`
  backgrounded from the Bash tool silently returns nothing. Use
  `/usr/bin/log show --last 5m` retrospectively instead.
- The decisive query: `--predicate 'process == "kernel" AND eventMessage
  CONTAINS "Sandbox: readest"'`. Sandbox denials do NOT appear under a
  `process == "readest"` predicate — they are logged by `kernel`.
- The app refuses to become frontmost via `activate` / `set frontmost`; to see
  it, hide the covering app (`set visible of process "iTerm2" to false`) then
  `screencapture -x`. System python3 has no `Quartz`, so no window-ID capture.

## Side finding: secret in the unified log
`~/.zshrc` exports `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` in plaintext. Launching the app from that
shell makes `runningboardd` write the **entire environment** into the macOS
unified log as part of the RBSLaunchRequest job description — key and password
together. Anything that collects a sysdiagnose captures them.


## Index status as of 2026-08-24 (moved verbatim from MEMORY.md)
- [MAS blank window](mas-sandbox-blank-customrootdir.md) hardening MERGED #5789; stale `customRootDir` sandbox-denied; runtime verify PENDING; macOS custom root has NO security-scoped bookmark; readest has NO VERSION file (`/ship` bump N/A)
