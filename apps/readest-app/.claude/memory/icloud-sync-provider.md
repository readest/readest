---
name: icloud-sync-provider
description: "iCloud as fifth cloud sync backend (iOS/macOS Tauri only) — PR #5532 open; portal + device verify pending"
metadata: 
  node_type: memory
  type: project
  originSessionId: c14ae948-5947-4c4a-b2cf-1e5bc7b0567b
  modified: 2026-08-06T13:23:57.781Z
---

# iCloud Cloud Sync provider — PR #5532 (2026-08-06)

**MERGED 2026-08-06** as squash commit `79dfc83f6` on main (PR
https://github.com/readest/readest/pull/5532); worktree and local branch
removed (worktree removal needed `--force`: worktrees containing submodules
refuse plain remove). All gates were green (8748 unit tests, conformance
suite, clippy, test:rust). ONE discovered deviation from the plan:
the three macOS `Entitlements*.plist` are GITIGNORED local signing inputs
(`.gitignore` "certs and keys" section, next to `tauri.*.conf.json`) — they
cannot ship in the PR. Their iCloud keys are a release-checklist step in the
PR body, to be done AFTER the Apple-portal capability exists (entitlements a
profile can't back = launch-killed app). Only `Readest_iOS.entitlements` +
both Info.plists are tracked. i18n: 8 new keys x33 locales, long strings
derived from the OneDrive translations (zh uses Apple's official
"iCloud 云盘"/"iCloud 雲碟").

**Apple portal DONE (2026-08-06, verified in Chrome):** iCloud capability
(CloudKit-support mode) enabled on App ID `com.bilingify.readest`
(record W2MFVY8AR6); account has exactly ONE container,
`iCloud.com.bilingify.readest` — matches the entitlements pin and the
code's nil-identifier default-container resolution. Side effect: the
capability change INVALIDATED most provisioning profiles
(iOS-AppStore-251202, iOS-readest-260531, Mac-AppStore-251202,
macos-applestore-dev, Readest AppStore, ReadestiOSDev; only the Share
Extension profile survived) — regenerate before the next signed build.
Local `Entitlements-appstore{,-dev}.plist` now carry the three iCloud
keys (added post-portal). `Entitlements.plist` (Developer ID direct)
deliberately still WITHOUT them pending the Dev-ID-supports-CloudDocuments
spike — unbacked restricted entitlements = launch-killed app.

**Profiles regenerated 2026-08-06 (via Chrome, user-requested):** all six
invalidated profiles re-issued with iCloud in their capability set —
iOS-AppStore-251202 / iOS-readest-260531 / Mac-AppStore-251202 /
Readest AppStore (2026/12/02), macos-applestore-dev (2027/08/06),
ReadestiOSDev (offline dev, 2026/08/13 short expiry by design). Readest
AppStore needed a cert re-pick (old cert expired; chose the unified
"Bilingify LLC(Distribution) Xcode 11+" like the others). Portal UI quirk:
dev-profile cert checkboxes render unchecked despite "N of N selected" —
double-toggle Select All to normalize before saving. Three legacy Expired
profiles (Readest Mac App Store, Readest-iOS-AppStore, Readest_Mac_appstore)
left untouched. Profiles are NOT downloaded/installed locally — Xcode
auto-signing / fastlane refetch by name on next build.

**macOS dev build VERIFIED LAUNCHING 2026-08-06.**
`pnpm build-macos-universial-appstore-dev` embeds
`certs/apple/Readest_Mac_appstore-dev.provisionprofile` (now the fresh
profile, fetched via ASC API script — the portal Download button does NOT
work from automated Chrome clicks; use POST-signed JWT + GET
/v1/profiles?filter[name]=X&fields[profiles]=profileContent). TWO traps hit:
1. **Launch error 153** (RBSRequestErrorDomain 5, silent exec-kill, no
   amfid log): the Mac was registered in the portal by HARDWARE UUID
   (B1180B75..., 2024-era) but Apple Silicon AMFI validates the
   **Provisioning UDID** (00006000-000648A93CA3801E, from system_profiler).
   Fix: register a second device with the Provisioning UDID (ASC API
   POST /v1/devices platform MAC_OS), add it to the profile, refetch.
   No `com.apple.application-identifier` entitlement needed (tested).
2. Yearly device-list reset gate blocks adding devices until confirmed
   in the portal (keep-all + acknowledge checkbox).
Old expired profile backed up at /tmp/*.bak-expired. App runs from
/tmp/Readest-icloud-test.app and the re-signed target bundle.

**macOS SMOKE PASSED 2026-08-06 19:04** (user enabled + synced in-app):
`Documents/Readest/library.json` (778KB wire) + ALL 698 book dirs written;
book binaries uploading progressively (Upload Book Files auto-on per
activation design); `brctl status` shows container foreground
needs-sync-up/last-sync-was-up = daemon replicating. ~1.3GB and growing —
698-book library mirrors into the user's personal iCloud quota.
SEPARATE pre-existing issue found: the SANDBOXED appstore-dev app renders a
BLANK window (unsandboxed same binary renders fine; last sandboxed run was
2025-08-20; suspect stale container state in
~/Library/Containers/com.bilingify.readest). Investigate before next Mac
App Store submission — NOT caused by the iCloud change (blank persists with
iCloud entitlements stripped).

**iOS SMOKE PASSED 2026-08-06** (user-confirmed): `pnpm build-ios` (dev
signing, Xcode-managed team profile auto-minted WITH iCloud), installed to
"Xin的 iPhone" (XS Max) via
`xcrun devicectl device install app --device <coredevice-uuid> <ipa>`
(iPhone 14 Pro kept reporting DeviceLocked over the WiFi tunnel — devicectl
needs the phone UNLOCKED at mount time; the XS Max worked). iOS+macOS
two-device sync verified working by user.

**Release-lane signing audit (2026-08-06):**
- iOS App Store: NOTHING to do. pbxproj has no PROVISIONING_PROFILE_SPECIFIER
  (automatic), IOS_MOBILE_PROVISION commented out, ASC API key drives
  xcodebuild -allowProvisioningUpdates → fetches fresh portal profiles
  (all regenerated with iCloud).
- Mac App Store: `tauri.appstore.conf.json` embeds
  `certs/apple/MacAppStore251202.provisionprofile` — local file WAS the
  old invalidated no-iCloud copy; REFRESHED 2026-08-06 via ASC API
  (uuid d3bdf01c, 4 icloud hits, exp 2026-12-01). Backup at
  /tmp/MacAppStore251202.provisionprofile.bak-preicloud.
  Entitlements-appstore{,-dev}.plist already carry iCloud keys.
- GitHub Actions release/nightly (direct macOS): NO changes needed —
  signs with Developer ID cert secrets (APPLE_CERTIFICATE/IDENTITY), no
  provisioning profile, no entitlements file in tracked tauri.conf.json →
  direct builds ship WITHOUT iCloud entitlements and the runtime probe
  degrades to "iCloud is not available on this device". Enabling iCloud
  there = the Developer ID spike (profile + entitlements + workflow secret).

**Developer ID spike RESOLVED 2026-08-06: iCloud Documents IS supported
under Developer ID.** ASC API `POST /v1/profiles` with
profileType=MAC_APP_DIRECT (bundleId W2MFVY8AR6 + the 4 Developer ID
Application certs) issued profile `Readest-DeveloperID-iCloud-spike`
(id B8J9N8U79R, ACTIVE, expires 2027-02-01 = cert expiry,
ProvisionsAllDevices=true) whose Entitlements grant icloud-services=*,
ubiquity-container-identifiers AND icloud-container-identifiers
(environment=Production, fixed). END-TO-END VERIFIED locally: universal
app re-signed `codesign --options runtime` with "Developer ID Application:
Bilingify LLC" + 4 iCloud entitlement keys (incl.
icloud-container-environment=Production) + embedded spike profile →
launches AND syncs library.json through the container.
Productionizing = new PR: commit the profile (NOT a secret — ships in
every app) + a tracked direct-entitlements plist + CI-only conf overlay
passed via `--config` in the macOS release/nightly jobs. MUST stay
CI-only: gitignore blocks `Entitlements*.plist` and `tauri.*.conf.json`
(use non-matching names/paths), and local `pnpm dev-macos` is AD-HOC
signed — ad-hoc + restricted entitlements = launch-killed. Maintenance:
profile dies with the Dev ID cert (2027-02-01) — regenerate + recommit on
cert renewal.

**Developer ID productionized: MERGED as `0e518d1f6` (#5537, 2026-08-06);
worktree and branch removed.** Portal profile renamed
to `Readest-DeveloperID` (id GU2694KMF7; spike profile deleted). Repo:
`src-tauri/profiles/{ReadestDeveloperID.provisionprofile,direct-entitlements.plist}`
+ `src-tauri/tauri.macos-nonestore.conf.json` overlay (renamed per user; matches the gitignored `tauri.*.conf.json` pattern so it carries a `!` negation in .gitignore), wired via `--config` into
release.yml + nightly.yml macOS matrix args + `build-macos-universial`.
VERIFIED full pipeline locally: notarization Accepted + stapled; DMG app
= 4 icloud entitlements + embedded profile + spctl "Notarized Developer
ID". Gotchas hit: worktree lacks gitignored `private_keys/` (notarytool
key path is relative — copy dir in); STALE /Volumes/Readest mounts made a
fresh DMG look entitlement-less (mount with explicit -mountpoint before
inspecting). Profile dies with the Dev ID cert 2027-02: regenerate +
recommit on renewal.

**ALL SHIPPED.** Every distribution channel now carries iCloud sync:
dev builds, iOS + Mac App Store, and direct-download DMGs (from the next
release/nightly). Remaining follow-ups: MAS sandbox-blank investigation
before next MAS submission; Finder iCloud Drive folder-name visibility
eyeball after a version bump; regenerate + recommit
Readest-DeveloperID.provisionprofile when the Developer ID cert renews
(2027-02-01).

Spec and plan (both approved by user, gitignored local-only):
`.agents/plans/2026-08-06-icloud-sync-provider-{design,plan}.md`.

**Product decisions (user-confirmed):** premium-gated like other third-party
providers; container VISIBLE in iCloud Drive as "Readest" (Documents scope +
`NSUbiquitousContainers`); Developer ID macOS builds attempted (spike: Apple
may limit Dev ID iCloud to CloudKit — if so, revert the three iCloud keys from
`Entitlements.plist` or the signed app is killed at launch, and ship App
Store-only with runtime degradation).

**Design:** `'icloud'` joins [[multi-provider-cloud-sync-5062]]'s
`FileSyncBackendKind` (appended LAST). TS `FileSyncProvider` does plain
plugin-fs I/O rooted at the ubiquity container's `Documents/`; only two native
commands in tauri-plugin-native-bridge: `icloud_container_status` (resolve
container off main thread, create Documents/) and `icloud_ensure_downloaded`
(startDownloadingUbiquitousItem + poll; iOS never auto-downloads, macOS
evicts). Key tricks:

- Engine paths all start `/Readest/…` (`SYNC_BASE_DIR`), so the EXISTING
  `**/Readest/**` fs capability scope covers the container — only
  `fs:allow-copy-file` is a new permission.
- Writes are atomic via dot-prefixed `.readest-tmp-*` + rename (iCloud must
  never upload a torn library.json); `list()` coalesces `.name.icloud`
  placeholders and skips ALL other dot-files (.DS_Store); `head()` never
  forces a download (reports placeholder-only as `{}`, size unknown).
- No auth concept: "forbidden path" (fs scope denial) maps to AUTH_FAILED;
  `canBackendRun('icloud')` hard-gates non-Apple platforms because
  `icloud.enabled` can arrive via settings replica on any device.
- iCloud sign-out on macOS leaves the local container usable — sync just
  stops replicating; NOT an error state.

**v1 known limitations:** OS-mediated propagation latency (no NSMetadataQuery
kick); NSFileVersion conflicts = current version wins, engine re-merge
converges; ad-hoc dev builds report unavailable (need Apple Development
signing to test).

**Manual tail (Task 10):** Apple portal container creation, Developer ID
profile spike, Mac<->iPhone device smoke. Cannot be automated.
