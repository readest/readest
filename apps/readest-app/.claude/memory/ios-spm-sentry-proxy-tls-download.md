---
name: ios-spm-sentry-proxy-tls-download
description: "iOS build \"Resolve Package Graph\" hangs downloading Sentry xcframeworks - proxy breaks TLS 1.3; manual download + workspace-state.json inject"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 953eb6c3-86a7-43e6-b56e-5b14f2eacb28
---

# iOS SPM Sentry binary download hang behind TLS-1.3-breaking proxy

Symptom (2026-07-12, dev machine): `pnpm tauri ios build` / Xcode stalls at **"Resolve Package Graph"**, then errors:
`failed downloading '.../Sentry.xcframework.zip' ... downloadError("An SSL error has occurred and a secure connection to the server cannot be made")` for all 5 Sentry binary targets.

## Root cause
The dev machine routes through a local proxy `http://127.0.0.1:8118` that **breaks TLS 1.3 but works on TLS 1.2**. curl with default (1.3) dies `curl (56) ... tlsv1 alert protocol version`; `curl --tlsv1.2 --tls-max 1.2` succeeds. Xcode's SwiftPM downloader (URLSession) negotiates TLS 1.3 -> same alert -> binary artifact downloads fail. Sentry ships as `.binaryTarget` xcframeworks (5 variants) pulled from GitHub release assets (redirect to `release-assets.githubusercontent.com`), so resolution can't complete. git clone to github.com itself works (small, and/or different TLS path).

Secondary trap: repeated Xcode Run attempts pile up orphaned `xcodebuild` processes that deadlock on the per-DerivedData SPM resolution lock (all stuck at "Resolve Package Graph", low CPU, ppid=launchd). Kill the stray `xcodebuild` PIDs before retrying; run only ONE build path (terminal OR Xcode), never both.

## Fix (manual download + workspace-state inject) - WORKS
Reusable script + cached zips at `~/sentry-xcframeworks-8.58.4/` (`reinject.sh` + 5 verified zips, 452MB). Steps it automates:
1. Download each `<Target>.xcframework.zip` with `wget -c --tries=40` through the proxy (resumable; OpenSSL/1.2 path gets through where LibreSSL default + Xcode do not). Verify SHA256 against sentry-cocoa `Package.swift` checksums.
2. Extract each into `<DerivedData>/Readest-*/SourcePackages/artifacts/sentry-cocoa/<Target>/<Target>.xcframework` (zip's inner .xcframework name == target name).
3. Register all 5 in `<DerivedData>/.../SourcePackages/workspace-state.json` `object.artifacts` (state version 7). **Exact schema per entry (the gotcha):**
   ```json
   {"kind":{"xcframework":{}},
    "packageRef":{"identity":"sentry-cocoa","kind":"remoteSourceControl","location":"https://github.com/getsentry/sentry-cocoa","name":"Sentry"},
    "path":"<abs>/artifacts/sentry-cocoa/<Target>/<Target>.xcframework",
    "source":{"checksum":"<sha256>","type":"remote","url":"https://github.com/getsentry/sentry-cocoa/releases/download/8.58.4/<Target>.xcframework.zip"},
    "targetName":"<Target>"}
   ```
   `kind` MUST be the object `{"xcframework":{}}`, NOT the string `"xcframework"` - a string fails SwiftPM's decode and the WHOLE artifacts array is silently discarded -> it re-downloads and hangs. `source.type` is the flat `"remote"` form. Found the correct schema by grepping another Readest DerivedData that had a prior successful build's populated `artifacts`.

After inject, `xcodebuild -resolvePackageDependencies` completes in ~3s ("Resolved source packages: Sentry @ 8.58.4"), artifacts stay in state, no download.

## Notes
- Per-DerivedData; a Clean Build Folder / DerivedData delete requires re-running `reinject.sh` (no re-download - uses cached zips). DerivedData dir is keyed by the .xcodeproj path (`Readest-fqtnjgpqmxmwltbjkuiysivihutk` for the main checkout at `.../src-tauri/gen/apple/Readest.xcodeproj`).
- The 5 targets: `Sentry`(static, the one the app's `product: Sentry` uses), `Sentry-Dynamic`, `Sentry-Dynamic-WithARM64e`, `Sentry-WithoutUIKitOrAppKit`, `Sentry-WithoutUIKitOrAppKit-WithARM64e`. Xcode tries to download ALL 5 even though only `Sentry` is used, so inject all 5.
- Real long-term fix would be proxy TLS 1.3 support (or dropping the Sentry SPM dep). Unrelated to the CarPlay work ([[carplay-tts-support]]); surfaced while building to verify CarPlay. Xcode 26.2 (SDK iphoneos26.2) in use - see [[xcode26-swiftrs-ios-build-broken]] for separate swift-rs build breakage.
