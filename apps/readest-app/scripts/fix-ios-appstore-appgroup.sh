#!/usr/bin/env bash
# Re-attach the App Group entitlement to the widget/share extensions in the
# App Store IPA.
#
# Tauri's App Store export signs only the main app binary at archive time
# (the build log shows `Using codesigning identity override: ""` and then
# `Signing .../Readest.app/Readest` -- the main binary only). The embedded
# extensions therefore enter `xcodebuild -exportArchive` UNSIGNED, and the
# export re-sign derives a MINIMAL entitlement set for each extension
# (application-identifier, beta-reports-active, team-identifier, get-task-allow)
# that OMITS com.apple.security.application-groups -- even though each
# extension's provisioning profile grants it. The reading widget then reads an
# empty App Group snapshot and shows only a placeholder book icon, and the
# share extension loses its shared queue, with no build error.
#
# #4891/#5188 removed CODE_SIGN_ALLOW_ENTITLEMENTS_MODIFICATION from the
# extension targets; that was necessary but not sufficient because the appex
# still enters export unsigned (cf. reflect-open #612, same symptom class).
#
# Fix: for each extension take the entitlements the export already computed,
# add the App Group, and re-sign the .appex (keeping its existing embedded
# provisioning profile, which grants the group). Then re-seal the app bundle so
# its nested-code seal covers the new extension signatures. Runs before
# verify-ios-appstore-entitlements.sh, which then confirms the group is present.
set -euo pipefail

IPA="${1:?usage: fix-ios-appstore-appgroup.sh <path-to-ipa>}"
GROUP="group.com.biblophile.readest"
EXTS=(ReadestWidget ShareExtension)

if [ ! -f "$IPA" ]; then
  echo "fix-ios-appstore-appgroup: IPA not found at $IPA" >&2
  exit 1
fi
# Resolve to an absolute path so it survives the `cd "$WORK"` used when repacking.
IPA="$(cd "$(dirname "$IPA")" && pwd)/$(basename "$IPA")"

IDENTITY="$(security find-identity -p codesigning -v | awk '/Apple Distribution/ {print $2; exit}')"
if [ -z "${IDENTITY:-}" ]; then
  echo "fix-ios-appstore-appgroup: no 'Apple Distribution' signing identity found" >&2
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
unzip -q "$IPA" -d "$WORK"
APP="$(find "$WORK/Payload" -mindepth 1 -maxdepth 1 -name "*.app" | head -n 1)"
if [ -z "$APP" ] || [ ! -d "$APP" ]; then
  echo "fix-ios-appstore-appgroup: No .app found in Payload" >&2
  exit 1
fi

# Re-sign a binary, preserving the entitlements the export already computed and
# adding the App Group if it is missing.
resign_with_group() {
  local bin="$1" name="$2"
  local ent="$WORK/$name.entitlements.plist"
  codesign -d --entitlements :- --xml "$bin" 2>/dev/null > "$ent" || true
  if [ ! -s "$ent" ]; then
    cat << 'PLIST_EOF' > "$ent"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
</dict>
</plist>
PLIST_EOF
  fi
  if ! /usr/libexec/PlistBuddy -c "Print :com.apple.security.application-groups" "$ent" >/dev/null 2>&1; then
    /usr/libexec/PlistBuddy -c "Add :com.apple.security.application-groups array" "$ent" >/dev/null
  fi
  if ! grep -q "$GROUP" "$ent"; then
    /usr/libexec/PlistBuddy -c "Add :com.apple.security.application-groups: string $GROUP" "$ent" >/dev/null
  fi
  codesign --force --sign "$IDENTITY" --entitlements "$ent" "$bin" >/dev/null 2>&1
  echo "  re-signed $name with $GROUP"
}

# Sign the inner extensions first, then re-seal the containing app bundle so its
# nested-code seal covers the new extension signatures.
found_exts=0
for ext in "${EXTS[@]}"; do
  if [ -d "$APP/PlugIns/$ext.appex" ]; then
    resign_with_group "$APP/PlugIns/$ext.appex" "$ext"
    found_exts=1
  fi
done

if [ "$found_exts" -eq 1 ]; then
  APP_NAME="$(basename "$APP" .app)"
  resign_with_group "$APP" "$APP_NAME"
  codesign --verify --deep --strict "$APP"

  # Repack to a temp file first, then move over the original, so a zip failure
  # cannot destroy the input IPA.
  ( cd "$WORK" && zip -qr "$WORK/repacked.ipa" Payload )
  mv "$WORK/repacked.ipa" "$IPA"
  echo "Re-signed app extensions with $GROUP in $IPA"
else
  echo "No app extensions found in Payload - skipping extension re-signing"
fi
