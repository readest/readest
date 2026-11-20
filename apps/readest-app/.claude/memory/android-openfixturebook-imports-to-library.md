---
name: android-openfixturebook-imports-to-library
description: "The Android lane's openFixtureBook (VIEW intent) ADDS the EPUB to the library on the owner's Xiaomi, despite its \"transient\" comment"
metadata:
  node_type: memory
  type: project
  originSessionId: bcb43d5a-9a9c-4808-a1cf-2d27d85db81e
  modified: 2026-11-19T18:26:50.797Z
---

`openFixtureBook()` in `src/__tests__/android/helpers/reader.ts` says the VIEW-intent
"Open with" flow opens a book "transiently without touching the user's library". On
2026-11-20 (#7467 check, release APK, Xiaomi 13 368b0948) it did not: the test EPUB
"জয়পতাকাবাবু" showed up as a library card (not uploaded, "Upload book" button shown)
after the runs. Reported to the owner; not deleted without their say.

**Why:** the owner's phone library is synced; a stray fixture card is the same
incident class as [[feedback-pin-adb-serial]] (fixture book imported on the phone).

**How to apply:** don't run `openFixtureBook` / `pnpm test:android` on the owner's
Xiaomi unless they agree to a fixture card landing in their library. Prefer an
emulator (no system image installed as of 2026-11-20: `sdkmanager` one first) or
an existing library book via `readest://book/<hash>`. See [[android-cdp-e2e-lane]],
[[feedback-always-verify-on-xiaomi]].
