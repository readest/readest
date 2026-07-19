#!/usr/bin/env bash
# Fail-fast so a failing guard (below) aborts the release instead of letting a
# broken IPA reach altool. Without this, verify-ios-appstore-entitlements.sh
# could report a stripped App Group and the upload would still proceed (this is
# how 0.11.18 shipped with a dead widget despite the guard existing).
set -euo pipefail

pnpm tauri ios build --export-method app-store-connect

BUNDLE_DIR=src-tauri/gen/apple/build/arm64
IPA_BUNDLE=$BUNDLE_DIR/Readest.ipa

# Tauri signs only the main app binary at archive time, so the widget / share
# extensions enter -exportArchive unsigned and the export re-sign drops the App
# Group entitlement from them (the reading widget then ships dead). Re-attach it
# before the guard verifies the IPA. See the script header and #5188 for why the
# earlier CODE_SIGN_ALLOW_ENTITLEMENTS_MODIFICATION removal was not sufficient.
bash scripts/fix-ios-appstore-appgroup.sh "$IPA_BUNDLE"

# Guard: the App Store export re-sign must not strip the App Group entitlement
# from the widget / share extensions, or the reading widget ships dead. With
# `set -e` above, a failure here aborts the release before upload.
#
# NOTE: the build uses the committed src-tauri/gen/apple/Readest.xcodeproj as-is
# (Tauri does not re-run xcodegen). If you change project.yml (e.g. #4891
# removing CODE_SIGN_ALLOW_ENTITLEMENTS_MODIFICATION from the app extensions),
# regenerate the project and commit it:
#   (cd src-tauri/gen/apple && env -u FORCE_COLOR xcodegen generate)
# Run it WITHOUT FORCE_COLOR in the env: xcodegen expands ${VAR} from the
# generating shell, and pnpm/CI set FORCE_COLOR, which would bake a literal
# value into the "Build Rust Code" script phase and break the build. This guard
# still catches a stale pbxproj that strips the App Group and aborts the release.
bash scripts/verify-ios-appstore-entitlements.sh "$IPA_BUNDLE"

xcrun altool --upload-app --type ios --file $IPA_BUNDLE --apiKey $APPLE_API_KEY --apiIssuer $APPLE_API_ISSUER

echo "iOS build uploaded to App Store Connect."
echo "Submit it to App Store + TestFlight with:"
echo "  pnpm run submit-appstore-ios"
