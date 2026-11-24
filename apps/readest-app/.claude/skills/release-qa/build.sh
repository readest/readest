#!/bin/bash
# build.sh <app-dir> <log-dir> [linux|android|all]
# Builds what the QA run drives, from a fresh worktree's apps/readest-app:
#   Linux: Next.js production build, then a CEF debug binary with that frontend bundled
#          (target/debug/readest at the worktree root).
#   Android: x86_64 debug APK (gen/android/app/build/outputs/apk/universal/debug).
# Run it with the Bash sandbox disabled and in the background; logs go to <log-dir>.
set -x
A=$1; L=$2; WHAT=${3:-all}
cd "$A" || exit 1
mkdir -p "$L"
unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
export KEEP_SOURCEMAPS=1   # skips the Sentry upload
date
pnpm build > "$L/next-build.log" 2>&1 || pnpm build > "$L/next-build2.log" 2>&1 || exit 1
if [ "$WHAT" != android ]; then
  pnpm tauri build --debug --no-bundle --ignore-version-mismatches \
    --config '{"build":{"beforeBuildCommand":""}}' > "$L/cef-build.log" 2>&1 \
    || { echo "CEF build failed: $L/cef-build.log"; exit 1; }
  echo "CEF ok"; date
fi
if [ "$WHAT" != linux ]; then
  export JAVA_HOME=${JAVA_HOME_17:-/usr/lib/jvm/java-17-openjdk-amd64}   # needs a JDK 17 with javac
  export ANDROID_HOME=${ANDROID_HOME:-$HOME/dev/android-sdk-linux/sdk}
  export NDK_HOME=${NDK_HOME:-$ANDROID_HOME/ndk/25.1.8937393}
  pnpm exec dotenv -e .env.tauri -- pnpm tauri android build --debug -t x86_64 --apk \
    --config '{"build":{"beforeBuildCommand":""}}' > "$L/android-build.log" 2>&1 \
    || { echo "Android build failed: $L/android-build.log"; exit 1; }
  echo "ANDROID ok"; date
fi
# The Android build can rewrite gen/android files (AndroidManifest.xml): restore them from git.
git status --short | head
