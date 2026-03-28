#!/bin/bash

set -e

VERSION=$(jq -r '.version' package.json)
MANIFEST="./src-tauri/gen/android/app/src/main/AndroidManifest.xml"
BILLING_PERMISSION_LINE='<uses-permission android:name="com.android.vending.BILLING" />'

ised() {
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "$@"
  else
    sed -i "$@"
  fi

  return $?
}

echo "📦 Building Readest v$VERSION for F-Droid (FOSS flavor)"

# --- REMOVE BILLING PERMISSION BEFORE BUILD ---
if grep -q 'com.android.vending.BILLING' "$MANIFEST"; then
  echo "🧹 Removing BILLING permission from AndroidManifest.xml"
  ised "/com.android.vending.BILLING/d" "$MANIFEST"
  echo "✅ Removed BILLING permission"
fi

# --- BUILD FOSS FLAVOR (default, no Google Play services) ---
echo "🚀 Running: pnpm tauri android build (foss flavor)"
pnpm tauri android build

# --- RESTORE BILLING PERMISSION AFTER BUILD ---
if ! grep -q 'com.android.vending.BILLING' "$MANIFEST"; then
  echo "♻️  Restoring BILLING permission in AndroidManifest.xml"
  ised "/android.permission.INTERNET/a\\
    $BILLING_PERMISSION_LINE
  " "$MANIFEST"
fi

# --- COPY APK TO RELEASE DIR ---
APK_SRC="./src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk"
RELEASE_DIR="./releases"
mkdir -p "$RELEASE_DIR"

if [[ -f "$APK_SRC" ]]; then
  APK_DST="$RELEASE_DIR/readest-${VERSION}-foss-universal.apk"
  cp "$APK_SRC" "$APK_DST"
  echo "✅ FOSS APK copied to $APK_DST"
  echo "📏 Size: $(du -h "$APK_DST" | cut -f1)"
  echo "🔑 SHA256: $(shasum -a 256 "$APK_DST" | cut -d' ' -f1)"
else
  echo "⚠️  APK not found at $APK_SRC"
  echo "   Check the build output for errors."
fi

echo ""
echo "📋 Next steps for F-Droid submission:"
echo "   1. Upload the APK to the GitHub release for v$VERSION"
echo "   2. Update the F-Droid metadata in the fdroiddata repository"
echo "   3. Submit a merge request to https://gitlab.com/fdroid/fdroiddata"
