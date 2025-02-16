pnpm tauri ios build --export-method app-store-connect

BUNDLE_DIR=src-tauri/gen/apple/build/arm64
IPA_BUNDLE=$BUNDLE_DIR/Readest.ipa

xcrun altool --upload-app --type ios --file $IPA_BUNDLE --apiKey $APPLE_API_KEY --apiIssuer $APPLE_API_ISSUER
