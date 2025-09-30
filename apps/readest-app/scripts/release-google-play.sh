#!/bin/bash

set -e

VERSION=$(jq -r '.version' package.json)

if [[ -z "$VERSION" ]]; then
  echo "❌ Failed to extract version from package.json"
  exit 1
fi

echo "📦 Found version: $VERSION"

IFS='.' read -r MAJOR MINOR PATCH <<< "$VERSION"

if [[ -z "$MAJOR" || -z "$MINOR" || -z "$PATCH" ]]; then
  echo "❌ Invalid version format: $VERSION"
  exit 1
fi

# Convert x.y.z => x * 10000 + y * 1000 + z
VERSION_CODE=$((10#$MAJOR * 10000 + 10#$MINOR * 1000 + 10#$PATCH))
echo "🔢 Computed versionCode: $VERSION_CODE"

PROPERTIES_FILE="./src-tauri/gen/android/app/tauri.properties"
MANIFEST="./src-tauri/gen/android/app/src/main/AndroidManifest.xml"
INSTALL_PERMISSION_LINE='<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES"/>'
STORAGE_PERMISSION_LINE='<uses-permission android:name="android.permission.MANAGE_EXTERNAL_STORAGE"/>'

if [[ ! -f "$PROPERTIES_FILE" ]]; then
  echo "❌ File not found: $PROPERTIES_FILE"
  exit 1
fi

tmpfile=$(mktemp)
sed "s/^tauri\.android\.versionName=.*/tauri.android.versionName=$VERSION/" "$PROPERTIES_FILE" | \
sed "s/^tauri\.android\.versionCode=.*/tauri.android.versionCode=$VERSION_CODE/" > "$tmpfile"
mv "$tmpfile" "$PROPERTIES_FILE"

echo "✅ Updated $PROPERTIES_FILE"

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

if grep -q 'MANAGE_EXTERNAL_STORAGE' "$MANIFEST"; then
  echo "🧹 Removing MANAGE_EXTERNAL_STORAGE from AndroidManifest.xml"
  if ised "/MANAGE_EXTERNAL_STORAGE/d" "$MANIFEST"; then
    echo "✅ Successfully removed MANAGE_EXTERNAL_STORAGE"
  else
    echo "❌ Failed to remove MANAGE_EXTERNAL_STORAGE" >&2
    exit 1
  fi
fi

echo "🚀 Running: pnpm tauri android build"
pnpm tauri android build

# --- ADD PERMISSION BACK AFTER BUILD ---
if ! grep -q 'REQUEST_INSTALL_PACKAGES' "$MANIFEST"; then
  echo "♻️  Restoring REQUEST_INSTALL_PACKAGES in AndroidManifest.xml"
  ised "/android.permission.INTERNET/a\\
    $INSTALL_PERMISSION_LINE
  " "$MANIFEST"
fi

if ! grep -q 'MANAGE_EXTERNAL_STORAGE' "$MANIFEST"; then
  echo "♻️  Restoring MANAGE_EXTERNAL_STORAGE in AndroidManifest.xml"
  ised "/android.permission.WRITE_EXTERNAL_STORAGE/a\\
    $STORAGE_PERMISSION_LINE
  " "$MANIFEST"
fi

source .env.google-play.local
if [[ -z "$GOOGLE_PLAY_JSON_KEY_FILE" ]]; then
  echo "❌ GOOGLE_PLAY_JSON_KEY_FILE is not set"
  exit 1
fi
cd ../../
fastlane android upload_production
