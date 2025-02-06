pnpm run build-macos-universial-appstore

BUNDLE_DIR=../../target/universal-apple-darwin/release/bundle/macos
APP_BUNDLE=$BUNDLE_DIR/Readest.app
INSTALLER_BUNDLE=$BUNDLE_DIR/Readest.pkg

xcrun productbuild --sign "$APPLE_INSTALLER_SIGNING_IDENTITY" --component $APP_BUNDLE /Applications $INSTALLER_BUNDLE
xcrun altool --upload-app --type macos --file $INSTALLER_BUNDLE --apiKey $APPLE_API_KEY --apiIssuer $APPLE_API_ISSUER