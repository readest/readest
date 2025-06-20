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

if [[ ! -f "$PROPERTIES_FILE" ]]; then
  echo "❌ File not found: $PROPERTIES_FILE"
  exit 1
fi

HEADER_LINE=$(head -n 1 "$PROPERTIES_FILE")
{
  echo "$HEADER_LINE"
  echo "tauri.android.versionName=$VERSION"
  echo "tauri.android.versionCode=$VERSION_CODE"
} > "$PROPERTIES_FILE"

echo "✅ Updated $PROPERTIES_FILE"

echo "🚀 Running: pnpm tauri android build"
pnpm tauri android build
