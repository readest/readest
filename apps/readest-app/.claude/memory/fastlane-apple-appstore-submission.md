---
name: fastlane-apple-appstore-submission
description: "fastlane lanes for iOS/macOS App Store + TestFlight submission, and two gotchas (Tauri notarization trigger, fastlane cwd)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 6604c57a-dee4-4a6e-8624-540162f41a80
---

Readest's Apple App Store + TestFlight submission via fastlane (root `fastlane/Fastfile`, alongside the existing Android `upload_to_play_store` lanes). Builds are unchanged (`pnpm run release-ios-appstore` / `release-macos-universial-appstore` → `tauri build` + `xcrun altool --upload-app`); fastlane only does the post-upload App Store version + review submission and TestFlight distribution on the already-uploaded build.

Lanes (per-platform, each does App Store review submit AND TestFlight, sharing a `submit_apple_build` helper): `release_ios`, `release_macos`. App Store via `upload_to_app_store(skip_binary_upload: true, ipa:/pkg:, platform: "ios"/"osx", submit_for_review: true, automatic_release: true, force: true, skip_screenshots: true, skip_metadata: false, release_notes:{"en-US"=>...}, promotional_text:{"en-US"=>...})`; TestFlight via `upload_to_testflight(distribute_only: true, app_platform: "ios"/"osx", distribute_external: true, groups:["Beta Testers"])`. App Store submit runs FIRST (it waits for build processing, which the TestFlight distribute then needs). `release_notes_text` parses `apps/readest-app/release-notes.json` (latest version by `Gem::Version`, drops notes matching `/\b(?:Android|Windows|Linux)\b/i`, prefixes each `– `). Auth: `app_store_connect_api_key`. Commands: `pnpm run submit-appstore-ios` / `submit-appstore-macos`.

GOTCHA 1 (Tauri notarization): `tauri build` auto-notarizes the macOS App Store bundle whenever the FULL App Store Connect API key trio (`APPLE_API_KEY` + `APPLE_API_ISSUER` + `APPLE_API_KEY_PATH`) is in the build env. Notarization REJECTS App Store builds ("not signed with a valid Developer ID certificate" / "no secure timestamp") because they use an Apple Distribution cert — App Store apps are NOT notarized. So `APPLE_API_KEY_PATH` must stay OUT of `.env.apple-appstore.local` (the macOS build env). `asc_api_key` instead DERIVES the `.p8` path from the key id: `repo_path("apps/readest-app/private_keys/AuthKey_#{key_id}.p8")` (the keys are named `AuthKey_<KEYID>.p8`, same convention altool uses; honors an explicit `APPLE_API_KEY_PATH` when set, e.g. the iOS build env which DOES need it and iOS doesn't notarize).

GOTCHA 2 (fastlane cwd): fastlane changes cwd to the `./fastlane` folder when EXECUTING a lane (`__dir__` is just "."), so raw `File.read("./apps/...")` breaks with "No such file". `fastlane lanes` only PARSES (doesn't run lane bodies) so it won't catch this — verify path-dependent lanes by actually RUNNING one. Fix = `repo_path(rel) = File.expand_path(rel, File.expand_path("..", __dir__))`, route every path (release-notes.json, .p8, ipa, pkg) through it.

GOTCHA 3 (dotenv shadowing): bare `dotenv` on PATH is the Ruby gem (`-f` syntax); package.json scripts use the npm `dotenv-cli` (`-e` syntax) resolved from `apps/readest-app/node_modules/.bin`. The submit scripts run `dotenv -e .env.apple-appstore.local -- bash -c 'cd ../.. && fastlane release_*'` — the `cd ../..` is required because fastlane does NOT search upward for the `fastlane/` dir (pnpm runs scripts from `apps/readest-app`).
