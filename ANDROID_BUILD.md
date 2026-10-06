# Android Build Commands

## 1. Set environment

```bash
export ANDROID_HOME=~/Android/Sdk
export PATH=$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH
```

## 2. Install the remaining SDK packages

```bash
yes | sdkmanager --licenses
sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0"
```

> **Note:** `sdkmanager` needs network access to `dl.google.com`. If it hangs on your
> machine, run this part from a machine/network that can reach Google, then copy the
> resulting `~/Android/Sdk` back. The NDK is already local, so you only need these 3
> small packages.

## 3. Verify

```bash
sdkmanager --list_installed
```

You should see `ndk;28.2.13676358`, `platform-tools`, `platforms;android-36`, `build-tools;36.0.0`.

## 4. Build the debug APK

```bash
cd ~/tmp/red/readest/apps/readest-app
rm -rf src-tauri/gen/android
pnpm tauri android init
pnpm tauri icon ../../data/icons/readest-book.png
git checkout .
NDK_HOME=$ANDROID_HOME/ndk/28.2.13676358 pnpm tauri android build --debug -t aarch64
```

APK output:

```
src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
```

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
| platform-tools, platforms;android-36, build-tools;36.0.0 | Run step 2 |
| Build APK | Run step 4 |
