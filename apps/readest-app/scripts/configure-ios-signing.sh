#!/usr/bin/env bash
set -euo pipefail

APPLE_TEAM_ID="${APPLE_TEAM_ID:-9W7R4BWG7X}"
IOS_PROFILE_UUID="${IOS_PROFILE_UUID:-}"
BUILD_NUM="${BUILD_NUMBER:-1}"

echo "==> Configuring iOS Signing"
echo "    Team ID: $APPLE_TEAM_ID"
echo "    Profile UUID: $IOS_PROFILE_UUID"
echo "    Build Number: $BUILD_NUM"

mkdir -p src-tauri/gen/apple

cat << EOF > src-tauri/gen/apple/ExportOptions.plist
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>app-store-connect</string>
    <key>teamID</key>
    <string>${APPLE_TEAM_ID}</string>
    <key>signingStyle</key>
    <string>manual</string>
    <key>signingCertificate</key>
    <string>Apple Distribution</string>
    <key>provisioningProfiles</key>
    <dict>
        <key>com.biblophile.yomi</key>
        <string>${IOS_PROFILE_UUID}</string>
    </dict>
    <key>uploadBitcode</key>
    <false/>
    <key>compileBitcode</key>
    <false/>
    <key>uploadSymbols</key>
    <true/>
    <key>manageAppVersionAndBuildNumber</key>
    <false/>
</dict>
</plist>
EOF

if [ -f "src-tauri/gen/apple/project.yml" ]; then
    echo "==> Updating project.yml and regenerating Xcode project"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s/CFBundleVersion: .*/CFBundleVersion: \"$BUILD_NUM\"/" src-tauri/gen/apple/project.yml
        # Configure manual signing and bundle id
        sed -i '' "s/PRODUCT_BUNDLE_IDENTIFIER:.*/PRODUCT_BUNDLE_IDENTIFIER: com.biblophile.yomi\\
      CODE_SIGN_STYLE: Manual\\
      PROVISIONING_PROFILE_SPECIFIER: \"${IOS_PROFILE_UUID}\"\\
      CODE_SIGN_IDENTITY: \"Apple Distribution\"/" src-tauri/gen/apple/project.yml
    else
        sed -i "s/CFBundleVersion: .*/CFBundleVersion: \"$BUILD_NUM\"/" src-tauri/gen/apple/project.yml
        sed -i "s/PRODUCT_BUNDLE_IDENTIFIER:.*/PRODUCT_BUNDLE_IDENTIFIER: com.biblophile.yomi\n      CODE_SIGN_STYLE: Manual\n      PROVISIONING_PROFILE_SPECIFIER: \"${IOS_PROFILE_UUID}\"\n      CODE_SIGN_IDENTITY: \"Apple Distribution\"/" src-tauri/gen/apple/project.yml
    fi
    (cd src-tauri/gen/apple && env -u FORCE_COLOR xcodegen generate)
fi

# 3. Handle com.apple.developer.associated-domains in entitlements
HAS_ASSOC_DOMAINS=false
PROFILES_DIR="${HOME}/Library/MobileDevice/Provisioning Profiles"
PROFILE_TO_CHECK=""

if [ -n "${IOS_PROFILE_UUID:-}" ] && [ -f "$PROFILES_DIR/${IOS_PROFILE_UUID}.mobileprovision" ]; then
    PROFILE_TO_CHECK="$PROFILES_DIR/${IOS_PROFILE_UUID}.mobileprovision"
elif [ -f "$PROFILES_DIR/profile.mobileprovision" ]; then
    PROFILE_TO_CHECK="$PROFILES_DIR/profile.mobileprovision"
elif [ -d "$PROFILES_DIR" ]; then
    PROFILE_TO_CHECK="$(find "$PROFILES_DIR" -name "*.mobileprovision" | head -n 1 || true)"
fi

if [ -n "$PROFILE_TO_CHECK" ] && [ -f "$PROFILE_TO_CHECK" ]; then
    echo "==> Inspecting provisioning profile: $PROFILE_TO_CHECK"
    if security cms -D -i "$PROFILE_TO_CHECK" 2>/dev/null | grep -q "com.apple.developer.associated-domains"; then
        HAS_ASSOC_DOMAINS=true
    fi
fi

if [ "$HAS_ASSOC_DOMAINS" = true ]; then
    echo "==> Provisioning profile includes com.apple.developer.associated-domains; ensuring Universal Links entitlement"
    for ent in $(find src-tauri/gen/apple -name "*.entitlements" 2>/dev/null); do
        if ! /usr/libexec/PlistBuddy -c "Print :com.apple.developer.associated-domains" "$ent" >/dev/null 2>&1; then
            echo "    Adding com.apple.developer.associated-domains to $ent"
            /usr/libexec/PlistBuddy -c "Add :com.apple.developer.associated-domains array" "$ent" || true
            /usr/libexec/PlistBuddy -c "Add :com.apple.developer.associated-domains: string applinks:biblophile.com" "$ent" || true
        else
            echo "    Entitlements already has com.apple.developer.associated-domains in $ent"
        fi
    done
else
    echo "==> NOTICE: Provisioning profile does NOT include com.apple.developer.associated-domains"
    echo "    (To enable iOS Universal Links, enable 'Associated Domains' on com.biblophile.yomi in Apple Developer Portal and update IOS_PROVISIONING_PROFILE_BASE64)"
    echo "    Stripping com.apple.developer.associated-domains from entitlements to prevent xcodebuild code signing mismatch"
    for ent in $(find src-tauri/gen/apple -name "*.entitlements" 2>/dev/null); do
        if /usr/libexec/PlistBuddy -c "Print :com.apple.developer.associated-domains" "$ent" >/dev/null 2>&1; then
            echo "    Removing com.apple.developer.associated-domains from $ent"
            /usr/libexec/PlistBuddy -c "Delete :com.apple.developer.associated-domains" "$ent" || true
        fi
    done
fi

echo "==> iOS Signing configuration complete"
