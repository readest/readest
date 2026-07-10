pnpm tauri ios build --export-method app-store-connect

BUNDLE_DIR=src-tauri/gen/apple/build/arm64
IPA_BUNDLE=$BUNDLE_DIR/Readest.ipa

# Guard: the App Store export re-sign must not strip the App Group entitlement
# from the widget / share extensions, or the reading widget ships dead.
bash scripts/verify-ios-appstore-entitlements.sh "$IPA_BUNDLE"

xcrun altool --upload-app --type ios --file $IPA_BUNDLE --apiKey $APPLE_API_KEY --apiIssuer $APPLE_API_ISSUER

echo "iOS build uploaded to App Store Connect."
echo "Submit it to App Store + TestFlight with:"
echo "  pnpm run submit-appstore-ios"
