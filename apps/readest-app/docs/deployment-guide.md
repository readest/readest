# Mobile Publishing & Deployment Guide (iOS App Store & Google Play Store)

This guide provides an end-to-end walkthrough for building, signing, validating, and submitting the **Yomi** mobile app (Tauri v2 monorepo) to both the **Apple App Store** and **Google Play Store**.

---

## Table of Contents
1. [Prerequisites & Account Setup](#1-prerequisites--account-setup)
2. [Branding & Bundle Identifiers Checklist](#2-branding--bundle-identifiers-checklist)
3. [App Assets, Screenshots & Metadata Structure](#3-app-assets-screenshots--metadata-structure)
4. [Credentials & Environment Configuration](#4-credentials--environment-configuration)
5. [iOS App Store Release Pipeline](#5-ios-app-store-release-pipeline)
6. [Google Play Store Release Pipeline](#6-google-play-store-release-pipeline)
7. [Troubleshooting & Known Gotchas](#7-troubleshooting--known-gotchas)

---

## 1. Prerequisites & Account Setup

### Apple Developer Program
* Active **Apple Developer Account** (Individual or Organization).
* Access to **App Store Connect** with an **App Manager** or **Admin** role.
* Generated **App Store Connect API Key** (`.p8` private key file, Key ID, Issuer ID) with *Access to Certificates, Identifiers & Profiles* enabled.

### Google Play Console
* Active **Google Play Developer Account**.
* A **Google Cloud Service Account** with Play Console Admin/Release access and an exported `.json` key file.
* An **Android Keystore** (`.keystore` or `.jks` file) for signing production release builds.

---

## 2. Branding & Bundle Identifiers Checklist

Standardized Package / Bundle Identifier: **`com.biblophile.yomi`**

When changing the App Name or Bundle ID, update all of the following core files in sync:

| Target Surface | File Path | Field / Variable |
| :--- | :--- | :--- |
| **Tauri Core Config** | `apps/readest-app/src-tauri/tauri.conf.json` | `"identifier": "com.biblophile.yomi"` |
| **App Branding Service** | `apps/readest-app/src/services/branding.ts` | `APP_BUNDLE_ID = 'com.biblophile.yomi'` |
| **Apple Universal Links** | `apps/readest-app/public/.well-known/apple-app-site-association` | `"appIDs": ["<TEAM_ID>.com.biblophile.yomi"]` |
| **Android Asset Links** | `apps/readest-app/public/.well-known/assetlinks.json` | `"package_name": "com.biblophile.yomi"` |
| **Fastlane Pipeline** | `fastlane/Fastfile` | `app_identifier: "com.biblophile.yomi"` |
| **iOS Xcode Project Spec** | `apps/readest-app/src-tauri/gen/apple/project.yml` | `bundleIdPrefix` and `PRODUCT_BUNDLE_IDENTIFIER` |

> [!IMPORTANT]
> After modifying `project.yml`, regenerate the Xcode projectspec by running:
> ```bash
> (cd apps/readest-app/src-tauri/gen/apple && env -u FORCE_COLOR xcodegen generate)
> ```

---

## 3. App Assets, Screenshots & Metadata Structure

### App Icons & Visual Assets
* **iOS App Icon:** 1024x1024 PNG (RGB, no transparency/alpha channel) placed at `src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset`.
* **Android Icons:** 512x512 PNG store icon + high-resolution vector adaptive foreground/background XML icons placed at `src-tauri/gen/android/app/src/main/res/mipmap-*`.

### Fastlane Store Metadata Directory Structure
Store listing copy and metadata are managed cleanly in the repo:

```
fastlane/
├── Appfile
├── Fastfile
├── metadata/                  # iOS App Store metadata (en-US title, description, keywords)
├── metadata-macos/            # macOS Mac App Store metadata
├── metadata-play/             # Google Play Store listing metadata
│   └── android/
│       └── en-US/
│           ├── title.txt
│           ├── short_description.txt
│           └── full_description.txt
└── screenshots/               # Master screenshots (iOS, macOS, Android)
```

---

## 4. Credentials & Environment Configuration

Store all secret environment keys in git-ignored `.local` environment files inside `apps/readest-app/`:

### iOS App Store Environment Files

1. **`apps/readest-app/.env.ios-appstore.local`** (Used for Tauri iOS build):
   ```env
   APPLE_API_KEY=YOUR_10_CHAR_KEY_ID
   APPLE_API_ISSUER=YOUR_ISSUER_ID_UUID
   APPLE_API_KEY_PATH=/Absolute/Path/To/apps/readest-app/private_keys/AuthKey_YOUR_KEY_ID.p8
   ```

2. **`apps/readest-app/.env.apple-appstore.local`** (Used for Fastlane submission):
   ```env
   APPLE_API_KEY=YOUR_10_CHAR_KEY_ID
   APPLE_API_ISSUER=YOUR_ISSUER_ID_UUID
   ```
   > [!WARNING]
   > Do **NOT** include `APPLE_API_KEY_PATH` in `.env.apple-appstore.local`. Keeping it out prevents Tauri from accidentally triggering unwanted macOS notarization checks.

3. **API Key Location:** Place your `.p8` file at:
   `apps/readest-app/private_keys/AuthKey_<KEY_ID>.p8`

### Android Google Play Environment Files

**`apps/readest-app/.env.google-play.local`**:
```env
PACKAGE_NAME=com.biblophile.yomi
GOOGLE_PLAY_JSON_KEY_FILE=/Absolute/Path/To/fastlane/google-play-key.json
ANDROID_KEYSTORE_PATH=/Absolute/Path/To/apps/readest-app/release.keystore
ANDROID_KEYSTORE_PASSWORD=YOUR_KEYSTORE_PASSWORD
ANDROID_KEY_ALIAS=YOUR_KEY_ALIAS
ANDROID_KEY_PASSWORD=YOUR_KEY_PASSWORD
```

---

## 5. iOS App Store Release Pipeline

### Step 1: Register App ID & App Record
1. Go to **Apple Developer Portal** > **Identifiers** and register `com.biblophile.yomi` with App Groups & CarPlay capabilities enabled.
2. Go to **App Store Connect** > **Apps** > **+ New App**:
   * Name: `Yomi By Biblophile`
   * Bundle ID: `com.biblophile.yomi`
   * Primary Language: `English`
   * SKU: `com.biblophile.yomi`

### Step 2: Build the iOS Production Package
Run the static export, Rust compilation, and Xcode archive:
```bash
cd apps/readest-app
pnpm run build-ios-appstore
```

### Step 3: Verify & Patch App Extension Entitlements
Tauri exports embedded app extensions unsigned. Execute the entitlement fix and verification guard before upload:
```bash
# Re-attach App Group entitlement to widget/share extensions:
bash scripts/fix-ios-appstore-appgroup.sh src-tauri/gen/apple/build/arm64/Yomi.ipa

# Verify entitlement integrity:
bash scripts/verify-ios-appstore-entitlements.sh src-tauri/gen/apple/build/arm64/Yomi.ipa
```

### Step 4: Upload to App Store Connect
Upload the verified `.ipa` bundle using `altool`:
```bash
pnpm exec dotenv -e .env.ios-appstore.local -- bash -c \
  'xcrun altool --upload-app --type ios --file src-tauri/gen/apple/build/arm64/Yomi.ipa --apiKey $APPLE_API_KEY --apiIssuer $APPLE_API_ISSUER'
```

### Step 5: TestFlight & App Store Review Submission
Submit the uploaded build for review and distribute to TestFlight external groups:
```bash
pnpm run submit-appstore-ios
```

---

## 6. Google Play Store Release Pipeline

### Step 1: Register App in Play Console
1. Log in to **Google Play Console** > **Create App**.
2. Set Default Language, App Name (`Yomi`), and declare Free/Paid status.

### Step 2: Build Production Android App Bundle (`.aab`)
Compile the Android release bundle:
```bash
cd apps/readest-app
pnpm tauri android build --target aarch64 --bundle aab
```
The output AAB bundle will be placed at:
`src-tauri/gen/android/app/build/outputs/bundle/universalRelease/app-universal-release.aab`

### Step 3: Deploy via Fastlane Lanes
Deploy directly to the desired Play Store track using Fastlane:

```bash
# Upload to Internal Testing Track
pnpm exec dotenv -e .env.google-play.local -- fastlane android upload_internal

# Upload to Beta / Closed Testing Track
pnpm exec dotenv -e .env.google-play.local -- fastlane android upload_beta

# Upload to Production Track (includes store metadata & composite screenshots)
pnpm run release-google-play
```

---

## 7. Troubleshooting & Known Gotchas

### iOS Gotchas
1. **Stray `#endif` Directives in Swift Plugins:** Ensure custom Swift plugins (e.g. `NativeBridgePlugin.swift`) do not have stray `#endif` preprocessor lines, as `#if !DEBUG` blocks can accidentally comment out lifecycle delegates (`applicationWillResignActive`, `applicationDidEnterBackground`) during `--release` builds.
2. **Invalid Bundle Structure (`libapp.a`):** Never list static library directories (`Externals/`) under `sources` in `project.yml`. Static libraries must be linked via `dependencies`, not bundled as static resource files inside `.app`.
3. **`APPLE_API_KEY_PATH` Must Be Absolute:** `xcodebuild` requires `APPLE_API_KEY_PATH` to be a full absolute path (e.g., `/Users/.../AuthKey_XXX.p8`).

### Android Gotchas
1. **Google Play Metadata vs F-Droid Metadata:** Play Store metadata lives in `fastlane/metadata-play/android`, while F-Droid lives in `fastlane/metadata/android`. Keep them separate to prevent track metadata clobbering.
2. **All Files Access Policy:** If requesting `MANAGE_EXTERNAL_STORAGE` on Android, ensure Play Console declaration forms are completed prior to uploading production AAB builds.