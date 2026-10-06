# Android Build Commands

## 1. Set environment

```bash
export ANDROID_HOME=~/Android/Sdk
export NDK_HOME=$ANDROID_HOME/ndk/28.2.13676358
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
export PATH=$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH
```

> **Note:** Use Java 21 (`java-21-openjdk-amd64`). Gradle 8.14.3 does not support Java 25 — you will get `Unsupported class file major version 69` with it.

## 2. Install the remaining SDK packages

```bash
yes | sdkmanager --licenses
sdkmanager "platform-tools" "platforms;android-36" "build-tools;35.0.0"
```

> **Note:** `sdkmanager` needs network access to `dl.google.com`. If it hangs or returns 404 on your
> machine, run this part from a machine/network that can reach Google, then copy the
> resulting `~/Android/Sdk` back. The NDK is already local, so you only need these small
> packages.

## 3. Verify

```bash
sdkmanager --list_installed
```

You should see `ndk;28.2.13676358`, `platform-tools`, `platforms;android-36`, `build-tools;35.0.0`.

## 4. Build the debug APK

```bash
cd ~/tmp/red/readest/apps/readest-app
rm -rf src-tauri/gen/android
pnpm tauri android init
pnpm tauri icon ../../data/icons/readest-book.png
git checkout .
NDK_HOME=$ANDROID_HOME/ndk/28.2.13676358 JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 pnpm tauri android build --debug -t aarch64
```

APK output:

```
src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
```

### Build fixes applied to make this work

These are already configured in this checkout; reapply them after every
`tauri android init` (which regenerates the files):

1. **Android Gradle Plugin `8.11.0` → `8.7.3`** in
   `src-tauri/gen/android/build.gradle.kts` and `buildSrc/build.gradle.kts`.
   Version `8.11.0` does not exist in the Google Maven repo (404).

2. **Aliyun Maven mirror** at the top of the `repositories` blocks in both
   Gradle files, since `dl.google.com` is unreachable from this machine:

   ```kotlin
   maven { url = uri("https://maven.aliyun.com/repository/google") }
   maven { url = uri("https://maven.aliyun.com/repository/central") }
   ```

3. **`buildToolsVersion = "35.0.0"`** in every module's `android {}` block
   (app, the four local plugins, their `.tauri` dirs, the cargo-registry
   plugins, and `packages/tauri/crates/tauri/mobile/android`). AGP 8.7.3
   defaults to build-tools 34.0.0, which is not installed locally.

4. **`android.suppressUnsupportedCompileSdk=36`** appended to
   `src-tauri/gen/android/gradle.properties` so AGP 8.7.3 (tested up to
   compileSdk 35) does not fail on compileSdk 36.

## 5. Install on your phone

```bash
adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
```

---

## Summary

| Component | Status |
|---|---|
| NDK 28.2.13676358 | Already in place |
| cmdline-tools | Already in place |
| platform-tools, platforms;android-36, build-tools;35.0.0 | Run step 2 |
| Build APK | Run step 4 |
