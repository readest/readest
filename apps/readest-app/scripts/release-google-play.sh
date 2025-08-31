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
PERMISSION_LINE='<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES"/>'

if [[ ! -f "$PROPERTIES_FILE" ]]; then
  echo "❌ File not found: $PROPERTIES_FILE"
  exit 1
fi

tmpfile=$(mktemp)
sed "s/^tauri\.android\.versionName=.*/tauri.android.versionName=$VERSION/" "$PROPERTIES_FILE" | \
sed "s/^tauri\.android\.versionCode=.*/tauri.android.versionCode=$VERSION_CODE/" > "$tmpfile"
mv "$tmpfile" "$PROPERTIES_FILE"

echo "✅ Updated $PROPERTIES_FILE"

# --- REMOVE PERMISSION BEFORE BUILD ---
if grep -q 'REQUEST_INSTALL_PACKAGES' "$MANIFEST"; then
  echo "🧹 Removing REQUEST_INSTALL_PACKAGES from AndroidManifest.xml"
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "/REQUEST_INSTALL_PACKAGES/d" "$MANIFEST"
  else
    sed -i "/REQUEST_INSTALL_PACKAGES/d" "$MANIFEST"
  fi
fi

echo "🚀 Running: pnpm tauri android build"
pnpm tauri android build

# --- ADD PERMISSION BACK AFTER BUILD ---
if ! grep -q 'REQUEST_INSTALL_PACKAGES' "$MANIFEST"; then
  echo "♻️  Restoring REQUEST_INSTALL_PACKAGES in AndroidManifest.xml"
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "/android.permission.INTERNET/a\\
    $PERMISSION_LINE
    " "$MANIFEST"
  else
    sed -i "/android.permission.INTERNET/a \    $PERMISSION_LINE" "$MANIFEST"
  fi
fi

source .env.google-play.local
if [[ -z "$GOOGLE_PLAY_JSON_KEY_FILE" ]]; then
  echo "❌ GOOGLE_PLAY_JSON_KEY_FILE is not set"
  exit 1
fi
cd ../../
fastlane android upload_production
