#!/usr/bin/env bash
set -euo pipefail

APP_GRADLE="src-tauri/gen/android/app/build.gradle.kts"

if [ ! -f "$APP_GRADLE" ]; then
  echo "::error::Android app build.gradle.kts not found at $APP_GRADLE"
  exit 1
fi

if grep -q 'signingConfigs.getByName("release")' "$APP_GRADLE"; then
  echo "Signing config already present in $APP_GRADLE"
  exit 0
fi

if ! grep -q 'import java.util.Properties' "$APP_GRADLE"; then
  (echo "import java.util.Properties"; cat "$APP_GRADLE") > "$APP_GRADLE.tmp" && mv "$APP_GRADLE.tmp" "$APP_GRADLE"
fi

echo "Appending release signing configuration to $APP_GRADLE"
cat << 'EOF' >> "$APP_GRADLE"

val ksFile = rootProject.file("keystore.properties")
val ksProps = Properties()
if (ksFile.exists()) {
    ksFile.inputStream().use { ksProps.load(it) }
}

android {
    signingConfigs {
        create("release") {
            keyAlias = ksProps.getProperty("keyAlias")
            keyPassword = ksProps.getProperty("keyPassword")
            val sf = ksProps.getProperty("storeFile")
            if (sf != null) {
                storeFile = file(sf)
            }
            storePassword = ksProps.getProperty("password")
        }
    }
    buildTypes {
        getByName("release") {
            signingConfig = signingConfigs.getByName("release")
        }
    }
}
EOF
