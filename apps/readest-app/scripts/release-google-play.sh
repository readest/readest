#!/bin/bash

set -e

VERSION=$(jq -r '.version' package.json)
MANIFEST="./src-tauri/gen/android/app/src/main/AndroidManifest.xml"
INSTALL_PERMISSION_LINE='<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES"/>'

ised() {
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "$@"
  else
    sed -i "$@"
  fi

  return $?
}

# --- REMOVE PERMISSION BEFORE BUILD ---
if grep -q 'REQUEST_INSTALL_PACKAGES' "$MANIFEST"; then
  echo "🧹 Removing REQUEST_INSTALL_PACKAGES from AndroidManifest.xml"
  if ised "/REQUEST_INSTALL_PACKAGES/d" "$MANIFEST"; then
    echo "✅ Successfully removed REQUEST_INSTALL_PACKAGES"
  else
    echo "❌ Failed to remove REQUEST_INSTALL_PACKAGES" >&2
    exit 1
  fi
fi

# MANAGE_EXTERNAL_STORAGE stays in the Play build: Readest is a file manager
# style ebook reader and needs All Files Access to keep the library in a
# user-chosen shared folder (issues #5372 and #2862). Play requires a written
# justification in the permission declaration form for every release that
# ships it — see docs/google-play-all-files-access.md for the text to paste.
if ! grep -q 'MANAGE_EXTERNAL_STORAGE' "$MANIFEST"; then
  echo "❌ MANAGE_EXTERNAL_STORAGE is missing from AndroidManifest.xml" >&2
  exit 1
fi

source .env.google-play.local

# --- VERSION CODE ---
# Play refuses a versionCode it has already seen, and every other Android build
# rewrites tauri.properties with the version's own code, so the last Play code
# can't be read back from there. Use the version's code (major*1000000 +
# minor*1000 + patch), or one more than the highest code on Play if that is
# already at or above it.
VERSION_CODE=$(echo "${VERSION%%-*}" | awk -F. '{ print $1 * 1000000 + $2 * 1000 + $3 }')
LATEST_CODE=$( (cd ../.. && fastlane android latest_version_code) | sed -n 's/.*LATEST_VERSION_CODE=\([0-9]*\).*/\1/p' | tail -1)
if [[ ! "$LATEST_CODE" =~ ^[0-9]+$ ]]; then
  echo "❌ Could not read the highest versionCode from Google Play" >&2
  exit 1
fi
if ((LATEST_CODE >= VERSION_CODE)); then
  VERSION_CODE=$((LATEST_CODE + 1))
fi
echo "🔢 versionCode $VERSION_CODE for $VERSION (highest on Google Play: $LATEST_CODE)"

echo "🚀 Running: pnpm tauri android build (googleplay flavor)"
ORG_GRADLE_PROJECT_storeFlavor=googleplay pnpm tauri android build \
  --config "{\"bundle\":{\"android\":{\"versionCode\":$VERSION_CODE}}}"

# --- ADD PERMISSION BACK AFTER BUILD ---
if ! grep -q 'REQUEST_INSTALL_PACKAGES' "$MANIFEST"; then
  echo "♻️  Restoring REQUEST_INSTALL_PACKAGES in AndroidManifest.xml"
  ised "/android.permission.INTERNET/a\\
    $INSTALL_PERMISSION_LINE
  " "$MANIFEST"
fi

echo "📋 Reminder: this build declares MANAGE_EXTERNAL_STORAGE."
echo "   Play Console → App content → Permissions → All files access needs the"
echo "   justification from docs/google-play-all-files-access.md"

if [[ -z "$GOOGLE_PLAY_JSON_KEY_FILE" ]]; then
  echo "❌ GOOGLE_PLAY_JSON_KEY_FILE is not set"
  exit 1
fi

# --- GENERATE CHANGELOG FOR GOOGLE PLAY ---
# Play reads from fastlane/metadata-play (see metadata_path in Fastfile);
# fastlane/metadata/android is F-Droid's tree.
CHANGELOG_DIR="../../fastlane/metadata-play/android/en-US/changelogs"
mkdir -p "$CHANGELOG_DIR"

NOTES=$(jq -r --arg ver "$VERSION" '.releases[$ver].notes // empty | map("• " + .) | join("\n")' release-notes.json)
if [[ -n "$NOTES" ]]; then
  # Google Play has a 500-character limit for release notes per language
  if [[ ${#NOTES} -gt 480 ]]; then
    NOTES="${NOTES:0:477}..."
  fi
  echo "$NOTES" > "$CHANGELOG_DIR/default.txt"
  echo "📝 Release notes for v$VERSION written to changelogs/default.txt"
else
  echo "⚠️  No release notes found for v$VERSION in release-notes.json"
fi

cd ../../

fastlane android upload_production
