---
name: biometric-app-lock-4645
description: "Biometric (fingerprint/Face ID) startup unlock layered over the PIN app-lock; gotchas for applock-store seeding, mobile-cfg crate, and scoped i18n"
metadata: 
  node_type: memory
  type: project
  originSessionId: 7d0f633b-0e69-405e-a4b4-5a1b19723d86
---

Biometric app-lock (#4645, PR #4650, branch `feat/biometric-app-lock`): biometrics unlock at startup on Android/iOS, app PIN as fallback; desktop/web unchanged. Layered over the existing PIN lock — `pinCodeEnabled` stays the master switch, PIN crypto in `libs/crypto/applock.ts` untouched. All plugin access isolated behind `src/services/biometric.ts` (guarded no-op off mobile; `authenticate` uses `allowDeviceCredential:false` so PIN is the only fallback). New setting `biometricUnlockEnabled` defaults true only for NEW mobile setups; existing PIN users (undefined→off) opt in via a mobile-only toggle.

Non-obvious gotchas (cost real review/rework here):
- **`AppLockScreen` must read startup-snapshot settings from `appLockStore`, NOT `settingsStore`.** `Providers` seeds ONLY the app-lock store via `useAppLockStore.initialize()` (from its own `loadSettings()`), before the gate mounts. `settingsStore.settings` starts `{}` and is seeded later by page-level init — reading the flag from `settingsStore` in the gate RACES and silently no-ops. Fix = thread the value through `initialize()` like `pinHash`/`pinSalt`.
- **`tauri-plugin-biometric` is `#![cfg(mobile)]`** — empty on desktop, so registration must be `#[cfg(any(target_os="ios",target_os="android"))]`-gated (like `haptics`/`sign-in-with-apple`). Desktop `clippy:check` does NOT compile that line, so the Rust side needs a real device build to verify. The dep pin lands in the **workspace-root `Cargo.lock`** (resolved when cargo runs), NOT `src-tauri/Cargo.lock` (which doesn't exist/track here).
- **Scoped i18n without churn:** `public/locales/en` is NOT scanner-managed (key-as-content fallback). Running the full `i18n:extract` reconciles ALL strings and pulls in unrelated drift already on main (e.g. Word Lens keys). For a clean PR, discard the scanner output and add only your new keys to the 33 langs in `i18n-langs.json`. "Face ID"/"Touch ID" are Apple brands — keep verbatim in every locale.

Related: [[ios-instant-dict-double-popup]] (same applock/gate area), [[custom-fonts-reincarnation-4410]] (settings-sync flag patterns).
