#!/usr/bin/env bash
# Android CDP e2e lane: runs vitest against the Readest app installed on an
# adb-connected device or emulator. Soft-skips (exit 0) when no adb, no
# device, or no installed app is found, so it is safe in any environment.
# Select a device with ANDROID_SERIAL when several are attached.
set -uo pipefail
cd "$(dirname "$0")/.."

PKG="com.bilingify.readest"

if ! command -v adb >/dev/null 2>&1; then
  echo "[test:android] adb not found — skipping Android e2e lane"
  exit 0
fi

DEVICES=$(adb devices | tail -n +2 | awk '$2 == "device" { print $1 }')
if [ -z "$DEVICES" ]; then
  echo "[test:android] no adb device/emulator connected — skipping Android e2e lane"
  echo "[test:android] hint: start one with: emulator -avd <name> (see 'emulator -list-avds')"
  exit 0
fi

if ! adb shell pm list packages "$PKG" 2>/dev/null | grep -q "package:$PKG"; then
  echo "[test:android] $PKG is not installed on the device — skipping Android e2e lane"
  echo "[test:android] hint: install a dev build with: pnpm dev-android"
  exit 0
fi

exec pnpm exec vitest run --config vitest.android.config.mts "$@"
