# Nightly Update Channel — Design

Date: 2026-06-14
Status: Approved (post dual-voice review; ready for implementation plan)

## Goal

Add an opt-in **nightly** build channel to Readest's in-app updater for
Android, Windows, macOS, and Linux. A GitHub Actions job builds nightly
packages daily at 06:00 GMT+8 and uploads them plus a manifest to the
Cloudflare R2 release bucket (R2 only — no GitHub release). Users who opt in
(via a setting) can auto-check and manually check for nightly updates.

The **auto-check is isolated** from Tauri's built-in updater (Tauri's JS
`check()` is hardwired to the stable endpoint and uses plain semver, neither of
which fits the nightly channel). The **install** reuses Tauri's verified updater
where it can (macOS, Windows-NSIS) and the existing custom flows + a new
signature-verify gate elsewhere (Windows-portable, Linux-AppImage, Android).

Nightly version format: `<base>-<YYYYMMDDHH>`, e.g. `0.11.4-2026061406`
(stamped in GMT+8, hour precision). Built from **main**.

## Non-goals

- No iOS nightly (`hasUpdater` is already false on iOS).
- No nightly via Play Store / App Store builds (gated out by `hasUpdater`).
- No automatic downgrade when switching nightly → stable on the same base.
- No refactor of the existing `release.yml` (keep the stable pipeline untouched).

## 1. Version comparison rule (core)

Plain semver is wrong here: it ranks a nightly `0.11.4-2026061406` *below*
stable `0.11.4` (prerelease < release), which would offer a downgrade. We use a
base-aware comparator.

```
parseUpdateVersion(v):
  base  = "X.Y.Z" (semver core)
  stamp = the prerelease ONLY IF it is exactly 10 ASCII digits (YYYYMMDDHH), else null
  isNightly = stamp != null

isUpdateNewer(candidate, current) -> boolean:
  if base(candidate) != base(current):
    return semverCompareCore(candidate, current) > 0   // compare X.Y.Z cores only
  // same base:
  if candidate.isNightly && !current.isNightly: return true    // nightly built after stable
  if !candidate.isNightly && current.isNightly: return false   // no same-base downgrade
  if candidate.isNightly && current.isNightly:  return candidate.stamp > current.stamp
  return false                                                 // both stable, same base
```

Notes from review:
- A non-pure-10-digit prerelease (`-rc.1`, `-beta`, `-`, `-2026`) → `stamp =
  null` (treated as stable-ish core). Empty/undefined version → treated as "not
  newer" (never offered).
- `semverCompareCore` compares the `X.Y.Z` cores only (strip prerelease first),
  so `0.11.5 > 0.11.4-…` and `0.11.5-… > 0.11.4`.

### Dual implementation (single rule, shared test matrix)

The rule is needed in two places:
- **TypeScript** (`src/utils/version.ts`) — the isolated JS check and the
  Android/portable/AppImage routing.
- **Rust** — the `version_comparator` passed to Tauri's `UpdaterBuilder` for the
  macOS / Windows-NSIS install path (Tauri's default comparator is plain semver
  and would *reject* a same-base nightly).

Both implementations are validated against the **same** test-vector table below.
Drift is the named risk; the shared table is the mitigation.

| candidate | current | isUpdateNewer | rationale |
|---|---|---|---|
| `0.11.5` | `0.11.4-2026061406` | true | stable surpasses nightly (headline requirement) |
| `0.11.4-2026061506` | `0.11.4-2026061406` | true | newer nightly |
| `0.11.4-2026061406` | `0.11.4-2026061506` | false | older nightly |
| `0.11.4` | `0.11.4-2026061406` | false | no same-base stable downgrade |
| `0.11.4-2026061406` | `0.11.4` | true | stable user on nightly channel gets nightly |
| `0.11.5-2026070106` | `0.11.4` | true | higher-base nightly beats stable |
| `0.11.4` | `0.11.4` | false | identical stable |
| `0.11.4-2026061406` | `0.11.4-2026061406` | false | identical nightly |
| `0.11.4-rc.1` | `0.11.4` | false | non-stamp prerelease → stable-ish, not newer |
| `` / undefined | any | false | malformed never offered |

## 2. Channel selection + isolated check

New system setting `updateChannel: 'stable' | 'nightly'`, default `'stable'`:
- Type: `src/types/settings.ts` (`SystemSettings`).
- Default: `src/services/constants.ts`.
- UI: a toggle in `src/app/library/components/SettingsMenu.tsx` directly under
  "Check Updates on Start", gated on `appService?.hasUpdater`. Label
  **"Nightly Builds (Unstable)"** with a `description` line (e.g. "Early daily
  builds; may be unstable") using the existing `MenuItem` description pattern.
  Persists via `saveSysSettings(envConfig, 'updateChannel', ...)`. No separate
  confirmation dialog (per decision — the "(Unstable)" label carries the warning).

`checkForAppUpdates(_, isAutoCheck)` in `src/helpers/updater.ts` branches on
channel:
- **stable** → unchanged (Tauri `check()` desktop, custom Android fetch).
- **nightly** → isolated resolution (does NOT call Tauri `check()` to decide):
  1. Fetch `nightly/latest.json` AND stable `latest.json` (failures handled
     independently; one missing manifest must not break the other).
  2. **Filter first, then compare** (review fix): for the current platform key,
     drop any manifest that lacks a usable `platforms[key]` entry (URL +
     signature). A stable `0.11.5` manifest missing the current platform must not
     mask a valid nightly.
  3. Among eligible candidates, pick the winner by `isUpdateNewer`
     (manifest-vs-manifest), and require `isUpdateNewer(winner.version,
     installedVersion)`.
  4. Route to install (§3) with the winner's manifest URL + platform key.

This **single resolution lives in `updater.ts`**; the resolved winner (endpoint
URL + platform key + version/notes) is passed into `UpdaterWindow` via the
existing `setUpdaterWindowVisible` event payload. `UpdaterWindow` no longer
re-fetches or re-decides with `semver.gt` (review fix: kills the dual-source
drift between `isUpdateNewer` and `semver.gt`).

Both auto-check (throttled 24h, on start) and manual-check (About dialog) flow
through this.

## 3. Install architecture

| Platform | Nightly install | Signature verification |
|---|---|---|
| macOS | Tauri `UpdaterBuilder` (Rust cmd) → `.app.tar.gz` swap + relaunch | Tauri built-in (minisign) |
| Windows NSIS | Tauri `UpdaterBuilder` (Rust cmd) → NSIS install + relaunch | Tauri built-in (minisign) |
| Windows portable | existing custom JS: download `.exe` + launch + exit | **new** `verify_update_signature` (minisign) gate |
| Linux AppImage | existing custom JS: download AppImage + chmod + launch | **new** verify gate |
| Android | existing custom JS: download APK + `installPackage` | **new** verify gate |

This matches how *stable* already splits platforms (Tauri `check()` is used for
macOS / Windows-NSIS; portable / AppImage / Android use custom JS flows).

### Rust pieces (in `tauri-plugin-native-bridge` or a small updater module)

1. `install_nightly_update(endpoint_url: String)` — builds
   `app.updater_builder().endpoints([endpoint_url])?.version_comparator(is_update_newer)`,
   then `check()` + `download_and_install()`, emitting progress events the dialog
   subscribes to, then relaunch. Used for macOS + Windows-NSIS. Reuses Tauri's
   minisign verification + native install. When the winner is the *stable*
   manifest (stable surpassed the nightly), the same command is pointed at the
   stable `latest.json` endpoint — the base-aware comparator confirms
   `0.11.5 > 0.11.4-nightly` and installs. (This is why §2.4 of the prior draft —
   "delegate to Tauri `check()`" — is replaced: we always drive a custom-endpoint
   updater, never the default-endpoint `check()`.)
2. `verify_update_signature(path: String, signature: String, pub_key: String) ->
   bool` — minisign verification (e.g. `minisign-verify` crate) of a downloaded
   artifact against the embedded Tauri pubkey. Called by the custom JS flows
   (portable / AppImage / Android) before launch/install. Abort install on failure.

The embedded pubkey is the same one in `src-tauri/tauri.conf.json` `updater.pubkey`.

## 4. Nightly manifest (`nightly/latest.json`)

Same shape as stable `latest.json` — Tauri standard updater platform keys for
desktop, plus the custom keys the JS flows read:

```json
{
  "version": "0.11.4-2026061406",
  "pub_date": "2026-06-14T06:00:00+08:00",
  "notes": "Nightly build. Recent: <top commit subjects>",
  "platforms": {
    "darwin-aarch64":  { "signature": "...", "url": ".../nightly/0.11.4-2026061406/Readest.app.tar.gz" },
    "darwin-x86_64":   { "signature": "...", "url": "..." },
    "windows-x86_64":  { "signature": "...", "url": ".../Readest_0.11.4-2026061406_x64-setup.nsis.zip" },
    "windows-aarch64": { "signature": "...", "url": "..." },
    "windows-x86_64-portable":  { "signature": "...", "url": ".../Readest_0.11.4-2026061406_x64-portable.exe" },
    "windows-aarch64-portable": { "signature": "...", "url": "..." },
    "linux-x86_64-appimage":  { "signature": "...", "url": ".../Readest_0.11.4-2026061406_x86_64.AppImage" },
    "linux-aarch64-appimage": { "signature": "...", "url": "..." },
    "android-universal": { "signature": "...", "url": ".../Readest_0.11.4-2026061406_universal.apk" },
    "android-arm64":     { "signature": "...", "url": ".../Readest_0.11.4-2026061406_arm64.apk" }
  }
}
```

The nightly build runs with `createUpdaterArtifacts: true` (already set), so the
desktop `.app.tar.gz` / NSIS / AppImage updater artifacts + `.sig` files are
produced exactly as in `release.yml`.

## 5. CI: `.github/workflows/nightly.yml`

- Triggers: `schedule: cron '0 22 * * *'` (22:00 UTC = 06:00 GMT+8) + `workflow_dispatch`.
- Compute version: checkout `main`; `BASE=$(node -p require .version)`;
  `STAMP=$(TZ=Asia/Shanghai date +%Y%m%d%H)`; `NIGHTLY=$BASE-$STAMP`.
  **Patch `apps/readest-app/package.json` version AFTER any `git checkout .`**
  (review catch: the Android init step does `git checkout .` and would revert an
  earlier patch). Never committed.
- Build matrix mirrors `release.yml` (android, linux x86_64, linux aarch64, macOS
  universal, windows x86_64, windows aarch64). Sign every artifact with
  `pnpm tauri signer sign`. Android `versionCode` stays Tauri-derived from the
  base (sideload allows equal versionCode; see [[android-sideload-same-versioncode]]).
- Publish **R2 only**, race-free across the parallel matrix:
  1. Each matrix job uploads its artifacts (+ `.sig`) to
     `r2:readest-releases/nightly/<version>/` and writes a per-platform manifest
     fragment to `nightly/<version>/manifest-fragments/<platform-arch>.json`.
  2. A final `assemble-manifest` job (`needs:` the matrix, `fail-fast:false`):
     downloads fragments, composes `nightly/latest.json` from the **succeeded**
     legs (partial-success allowed — one flaky leg must not block the channel),
     **atomically promotes** the manifest (upload to a temp key then move/replace),
     then prunes old `nightly/<version>/` folders keeping the newest 7 (sort by
     stamp, prune *after* the new upload).
  3. On scheduled-run or leg failure, surface it (job failure + a notification
     step) so a silently broken nightly is visible.
- Reuses existing secrets (`TAURI_SIGNING_*`, `ANDROID_KEY_*`, Apple signing,
  `RELEASE_R2_*`, Next.js public env) and the `rclone` R2 config from
  `upload-to-r2.yml`.
- **Drift note:** `nightly.yml` duplicates the `release.yml` build matrix. We
  keep them separate (not refactoring the stable pipeline now) but add a header
  comment cross-referencing `release.yml` so cert/NDK bumps are mirrored.

## 6. Client constants

```
// src/services/constants.ts
export const READEST_NIGHTLY_UPDATER_FILE =
  'https://download.readest.com/nightly/latest.json';
```

## 7. Files touched

Client:
- `src/utils/version.ts` — `parseUpdateVersion`, `isUpdateNewer` (TS).
- `src/services/constants.ts` — `READEST_NIGHTLY_UPDATER_FILE`; default `updateChannel`.
- `src/types/settings.ts` — `updateChannel`.
- `src/helpers/updater.ts` — channel-aware check; dual-manifest resolution
  (filter-then-compare); pass resolved winner to the window.
- `src/components/UpdaterWindow.tsx` — consume resolved winner (no re-decide);
  nightly routing; loading + fetch-error states; friendly nightly version render
  ("Nightly · 0.11.4 (Jun 14, 06:00)"); call `install_nightly_update` for
  macOS/Win-NSIS; add verify gate to portable/AppImage/Android flows.
- `src/app/library/components/SettingsMenu.tsx` — "Nightly Builds (Unstable)" toggle.

Rust:
- `src-tauri/plugins/tauri-plugin-native-bridge/` — `install_nightly_update`
  (custom-endpoint `UpdaterBuilder`) + `verify_update_signature` commands;
  `is_update_newer` (Rust mirror of the comparator); permissions/ACL entries.

CI:
- `.github/workflows/nightly.yml`.

Tests:
- `src/__tests__/utils/version.test.ts` — the shared comparator matrix (§1).
- Rust unit test for `is_update_newer` — the same matrix.
- `src/__tests__/helpers/updater.test.ts` — nightly branch: winner-nightly
  routing, stable-surpasses routing, platform-eligibility filter (stable missing
  current platform key → nightly still chosen), both-404, neither-newer-than-installed.

## 8. Decision log (from dual-voice review, 2026-06-14)

| Decision | Source | Outcome |
|---|---|---|
| Client-side signature verification on nightly install | USER CHALLENGE (Eng+Codex) | **Add** — Tauri built-in for mac/NSIS; new minisign command for portable/AppImage/Android |
| macOS install | taste (CEO) | **Reuse `.app.tar.gz` auto-replace** via Tauri updater (not DMG-open) |
| Desktop install mechanism | architecture confirm | **Reuse Tauri `UpdaterBuilder`** with custom endpoint + base-aware comparator |
| Opt-in friction | taste (Design) | **Toggle + "(Unstable)" label**, no confirmation dialog |
| Android versionCode collision | resolved by owner | **Non-issue** — sideload allows equal versionCode |
| Dual-manifest selection | Eng+Codex | **Filter by platform eligibility before comparing** |
| Channel decision duplicated | Eng | **Single source in `updater.ts`**; window consumes the resolved winner |
| Comparator malformed-stamp handling | Eng+Codex | **Pin stamp = pure 10 digits or null**; edge tests |
| CI version patch vs `git checkout .` | Codex | **Patch after checkout** |
| CI manifest assembly | Eng+Codex | **Fragments + atomic promote + partial-success + failure alert** |
| Cadence daily-from-main / R2-only / isolated | CEO+Codex reframe | **Kept** (user-specified; Codex concedes isolation is necessary) |
| nightly.yml ↔ release.yml duplication | CEO | **Keep separate** + cross-ref comment (don't refactor stable pipeline) |
