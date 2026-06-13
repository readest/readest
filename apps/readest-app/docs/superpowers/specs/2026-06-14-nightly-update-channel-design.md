# Nightly Update Channel — Design

Date: 2026-06-14
Status: Approved (pending spec review)

## Goal

Add an opt-in **nightly** build channel to Readest's in-app updater for
Android, Windows, macOS, and Linux. A GitHub Actions job builds nightly
packages at 06:00 GMT+8 daily and uploads them (and a manifest) to the
Cloudflare R2 release bucket. Users who opt into the nightly channel can
auto-check and manually check for nightly updates. The nightly checker is
**isolated from Tauri's built-in updater** (it never calls `check()` to decide
whether a nightly is available), but it refers to and reuses the existing
custom Android/portable/AppImage install flows.

Nightly version format: `<base>-<YYYYMMDDHH>`, e.g. `0.11.4-2026061406`
(stamped in GMT+8, with an hour-precision suffix).

## Non-goals

- No iOS nightly (no sideload updater path; `hasUpdater` is already false on iOS).
- No nightly via Play Store / App Store builds (those distribute through stores;
  gated out by `hasUpdater`).
- No client-side signature verification for the nightly self-install path
  (matches existing custom flows). Stable updates remain signature-verified.
- No automatic downgrade when switching nightly → stable on the same base version.

## 1. Version comparison rule (core)

Plain semver is incorrect for this feature: it ranks a nightly
`0.11.4-2026061406` *below* stable `0.11.4` (prerelease < release), which would
offer a nightly user a downgrade to the older stable `0.11.4`. We add a pure,
unit-tested comparator.

```
parseUpdateVersion(v):
  base  = "X.Y.Z" (semver core)
  stamp = numeric YYYYMMDDHH if a "-<digits>" prerelease is present, else null
  isNightly = stamp != null

isUpdateNewer(candidate, current) -> boolean:
  if base(candidate) != base(current):
    return semverCompareCore(candidate, current) > 0   // higher base wins
  // same base:
  if candidate.isNightly && !current.isNightly: return true    // nightly built after stable
  if !candidate.isNightly && current.isNightly: return false   // don't downgrade to same-base stable
  if candidate.isNightly && current.isNightly:  return candidate.stamp > current.stamp
  return false                                                 // both stable, same base
```

Required behaviors (become the test matrix):

| candidate | current | isUpdateNewer | rationale |
|---|---|---|---|
| `0.11.5` | `0.11.4-2026061406` | true | stable surpasses nightly (the headline requirement) |
| `0.11.4-2026061506` | `0.11.4-2026061406` | true | newer nightly |
| `0.11.4-2026061406` | `0.11.4-2026061506` | false | older nightly |
| `0.11.4` | `0.11.4-2026061406` | false | no same-base stable downgrade |
| `0.11.4-2026061406` | `0.11.4` | true | stable user on nightly channel gets nightly |
| `0.11.5-2026070106` | `0.11.4` | true | higher base nightly beats stable |
| `0.11.4` | `0.11.4` | false | identical stable |
| `0.11.4-2026061406` | `0.11.4-2026061406` | false | identical nightly |

Location: `src/utils/version.ts` (alongside `getAppVersion`). Tests in
`src/__tests__/utils/version.test.ts`.

## 2. Channel selection and the isolated check

New system setting `updateChannel: 'stable' | 'nightly'`, default `'stable'`:

- Type: `src/types/settings.ts` (`SystemSettings`).
- Default: `src/services/constants.ts` `DEFAULT_SYSTEM_SETTINGS`.
- UI: a toggle in `src/app/library/components/SettingsMenu.tsx`, directly under
  "Check Updates on Start", gated on `appService?.hasUpdater`. Label e.g.
  "Receive Nightly Builds"; `toggled = settings.updateChannel === 'nightly'`;
  persists via `saveSysSettings(envConfig, 'updateChannel', ...)`.

`checkForAppUpdates(_, isAutoCheck)` in `src/helpers/updater.ts` branches on
the channel:

- **stable** → unchanged (Tauri `check()` on macOS/Windows/Linux; custom
  Android fetch of `latest.json`). No behavior change for existing users.
- **nightly** → new isolated resolution (does NOT call Tauri `check()` to
  decide):
  1. Fetch `nightly/latest.json` (nightly manifest) and stable `latest.json`.
  2. `newest = the manifest whose version "wins" via isUpdateNewer`, also
     requiring `isUpdateNewer(newest.version, installedVersion)`.
  3. If `newest` is a **nightly** build → drive the isolated nightly install
     (download artifact from the nightly manifest; install per §3).
  4. If `newest` is **stable** (stable surpassed the nightly) → delegate to the
     existing stable updater for the platform (Tauri `check()` on macOS/Win/Linux,
     existing custom flows for portable/AppImage/Android). This satisfies "stable
     should be updatable from nightly" without re-implementing macOS
     `.app.tar.gz` / NSIS install.

Throttling (`CHECK_UPDATE_INTERVAL_SEC`, 24h, on-start) and manual check (About
dialog "Check Update") both flow through `checkForAppUpdates`, so both honor the
channel. Fetch failures of either manifest are handled gracefully (a missing
nightly manifest must not break the stable comparison, and vice versa).

## 3. Install matrix (nightly → nightly)

Per the "open standard installer" decision:

| Platform | Nightly artifact | Install action | Code |
|---|---|---|---|
| Android | APK | package-installer intent | reuse `installPackage` |
| Windows portable | `*-portable.exe` | launch new exe, exit | reuse existing |
| Linux | AppImage | chmod +x, launch, exit | reuse existing |
| Windows (installer) | NSIS `.exe` | spawn installer, then exit | new (small) |
| macOS | DMG | `open` the DMG; user drags app to Applications | new (small) |

Implemented in `src/components/UpdaterWindow.tsx` by constructing the nightly
`GenericUpdate` object (mirrors the existing `checkAndroidUpdate` /
`checkWindowsPortableUpdate` / `checkAppImageUpdate` builders). Platform/arch
selection reuses `osType()` / `osArch()`. The window's internal
`checkForUpdates` becomes channel-aware so the dialog builds the right update
object when opened on the nightly channel.

Artifact platform keys in `nightly/latest.json` (client reads these):
`android-universal`, `android-arm64`, `windows-x86_64-portable`,
`windows-aarch64-portable`, `windows-x86_64-nsis`, `windows-aarch64-nsis`,
`macos-universal-dmg`, `linux-x86_64-appimage`, `linux-aarch64-appimage`.
(Stable `latest.json` keeps its existing Tauri-format keys; the nightly client
only parses stable keys when delegating, which it does via Tauri `check()`, so
it does not need to read stable desktop keys directly.)

## 4. Nightly manifest schema (`nightly/latest.json`)

Same shape the client already understands:

```json
{
  "version": "0.11.4-2026061406",
  "pub_date": "2026-06-14T06:00:00+08:00",
  "notes": "Nightly build. Recent: <top commit subjects>",
  "platforms": {
    "android-arm64":   { "signature": "...", "url": "https://download.readest.com/nightly/0.11.4-2026061406/Readest_0.11.4-2026061406_arm64.apk" },
    "macos-universal-dmg": { "signature": "...", "url": "https://download.readest.com/nightly/0.11.4-2026061406/Readest_0.11.4-2026061406_universal.dmg" }
    // ... one entry per platform key in §3
  }
}
```

## 5. CI: `.github/workflows/nightly.yml`

- Triggers: `schedule: cron '0 22 * * *'` (22:00 UTC = 06:00 GMT+8) and
  `workflow_dispatch`.
- Compute version: checkout `main`; `BASE=$(node -p "require('./apps/readest-app/package.json').version")`;
  `STAMP=$(TZ=Asia/Shanghai date +%Y%m%d%H)`; `NIGHTLY=$BASE-$STAMP`. Patch
  `apps/readest-app/package.json` version to `$NIGHTLY` in-CI (never committed).
- Build matrix mirrors `release.yml`: android, linux x86_64, linux aarch64,
  macOS universal, windows x86_64, windows aarch64. Bundles DMG (macOS), NSIS
  `.exe` + portable `.exe` (Windows), AppImage (Linux), universal + arm64 APKs
  (Android). Sign each artifact with `pnpm tauri signer sign`
  (`TAURI_SIGNING_PRIVATE_KEY` / `..._PASSWORD`).
- Publish to **R2 only** (no GitHub release). To stay race-free across parallel
  matrix jobs:
  1. Each matrix job uploads its artifacts (+ `.sig`) to
     `r2:readest-releases/nightly/<version>/` via rclone (config mirrors
     `upload-to-r2.yml`).
  2. Each job writes a per-platform manifest fragment to
     `nightly/<version>/manifest-fragments/<platform-arch>.json`.
  3. A final `assemble-manifest` job (`needs:` the matrix) downloads all
     fragments, composes `nightly/latest.json` (version, pub_date, notes,
     merged `platforms`), uploads it to `r2:readest-releases/nightly/latest.json`,
     and prunes old `nightly/<old-version>/` folders keeping the newest 7.
- Reuses existing secrets: `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)`,
  `ANDROID_KEY_*`, Apple signing secrets, `RELEASE_R2_*`, Next.js public env.
- Build detail to verify during implementation: a prerelease version string
  (`0.11.4-2026061406`) must not break Android `versionCode` derivation or the
  Tauri bundler's version parsing. Tauri derives `versionCode` from the semver
  core, so this should be fine; confirm on first run and pin `versionCode`
  explicitly if needed.

## 6. Client constants

`src/services/constants.ts`:

```
export const READEST_NIGHTLY_UPDATER_FILE =
  'https://download.readest.com/nightly/latest.json';
```

(`READEST_UPDATER_FILE` / `READEST_CHANGELOG_FILE` unchanged.)

## 7. Files touched

Client:
- `src/utils/version.ts` — add `parseUpdateVersion`, `isUpdateNewer`.
- `src/services/constants.ts` — `READEST_NIGHTLY_UPDATER_FILE`; default `updateChannel`.
- `src/types/settings.ts` — `updateChannel` field.
- `src/helpers/updater.ts` — channel-aware check + nightly dual-manifest resolution.
- `src/components/UpdaterWindow.tsx` — nightly `GenericUpdate` builder; macOS-DMG
  and Windows-NSIS open install actions; channel-aware `checkForUpdates`.
- `src/app/library/components/SettingsMenu.tsx` — channel toggle.

CI:
- `.github/workflows/nightly.yml` — new scheduled build → R2 workflow.

Tests:
- `src/__tests__/utils/version.test.ts` — comparator matrix (§1).
- `src/__tests__/helpers/updater.test.ts` — extend with nightly-channel branch:
  newest-nightly routing, stable-surpasses delegation, manifest-fetch failure.

## 8. Decisions / defaults

- **Delegate to the stable updater when stable surpasses** (§2.4) rather than
  re-implementing macOS/NSIS install in the nightly path. (Approved.)
- **No client-side signature verification** for nightly self-install; artifacts
  are still signed, and the stable-surpasses path keeps Tauri verification. (Approved.)
- Nightly "changelog" is the `notes` string in `nightly.json` (recent commit
  subjects); the updater window already falls back to `update.body`.
- Switch-back (nightly → same-base stable) is not auto-offered.
- Source branch is `main`; the hour-precision GMT+8 stamp keeps a single build/day
  monotonically increasing.
```
