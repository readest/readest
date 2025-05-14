#!/bin/bash
set -e

echo "Updating bundleVersion in tauri.appstore.conf.json..."

CONFIG_FILE="src-tauri/tauri.appstore.conf.json"
CURRENT_DATE=$(date "+%Y%m%d.%H%M%S")

if [ ! -f "$CONFIG_FILE" ]; then
  echo "Error: Config file $CONFIG_FILE not found!"
  exit 1
fi

TMP_FILE=$(mktemp)
cat "$CONFIG_FILE" | jq --arg version "$CURRENT_DATE" '.bundle.macOS.bundleVersion = $version' > "$TMP_FILE"
mv "$TMP_FILE" "$CONFIG_FILE"
echo "Updated bundleVersion to $CURRENT_DATE"

echo "Building macOS universal app for App Store..."
pnpm run build-macos-universial-appstore

BUNDLE_DIR=../../target/universal-apple-darwin/release/bundle/macos
APP_BUNDLE=$BUNDLE_DIR/Readest.app
INSTALLER_BUNDLE=$BUNDLE_DIR/Readest.pkg

xcrun productbuild --sign "$APPLE_INSTALLER_SIGNING_IDENTITY" --component $APP_BUNDLE /Applications $INSTALLER_BUNDLE
xcrun altool --upload-app --type macos --file $INSTALLER_BUNDLE --apiKey $APPLE_API_KEY --apiIssuer $APPLE_API_ISSUER