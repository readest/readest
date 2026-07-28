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
echo "🚀 Running: pnpm tauri android build (googleplay flavor)"
ORG_GRADLE_PROJECT_storeFlavor=googleplay pnpm tauri android build --config src-tauri/tauri.playstore.conf.json

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
CHANGELOG_DIR="../../fastlane/metadata/android/en-US/changelogs"
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
