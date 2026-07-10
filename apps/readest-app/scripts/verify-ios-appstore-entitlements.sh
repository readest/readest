#!/usr/bin/env bash
# Verify the App Store IPA's app extensions carry the App Group entitlement.
#
# group.com.bilingify.readest is how the main app hands the reading-widget
# snapshot (and the share extension its shared state) to its extensions via the
# shared App Group container. Automatic App Store signing re-signs embedded
# extensions during `xcodebuild -exportArchive`; if a target sets
# CODE_SIGN_ALLOW_ENTITLEMENTS_MODIFICATION=YES, that re-sign silently strips
# com.apple.security.application-groups from the extension binary even though
# the provisioning profile and source .entitlements both grant it. The widget
# then reads an empty snapshot and shows only a placeholder book icon, with no
# build error. This guard fails the release before upload so it can't ship
# broken again.
set -euo pipefail

IPA="${1:-src-tauri/gen/apple/build/arm64/Readest.ipa}"
GROUP="group.com.bilingify.readest"
EXTS=(ReadestWidget ShareExtension)

if [ ! -f "$IPA" ]; then
  echo "verify-ios-appstore-entitlements: IPA not found at $IPA" >&2
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
unzip -q "$IPA" -d "$WORK"
APP="$WORK/Payload/Readest.app"

fail=0
for ext in "${EXTS[@]}"; do
  appex="$APP/PlugIns/$ext.appex"
  if codesign -d --entitlements :- "$appex" 2>/dev/null | grep -q "$GROUP"; then
    echo "OK   $ext.appex carries $GROUP"
  else
    echo "FAIL $ext.appex is MISSING $GROUP (App Group access broken)"
    fail=1
  fi
done

if [ "$fail" -ne 0 ]; then
  echo "" >&2
  echo "App Group entitlement missing from an extension binary. Do NOT set" >&2
  echo "CODE_SIGN_ALLOW_ENTITLEMENTS_MODIFICATION on extension targets in" >&2
  echo "src-tauri/gen/apple/project.yml." >&2
  exit 1
fi

echo "All app extensions carry the App Group entitlement."
