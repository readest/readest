---
name: android-auto-tts-3919
description: "Android Auto TTS (#3919, PR#4907) — Play rejected the Auto feature; manifest opt-in removed 2026-07-09 pending bug fix, re-add to re-enable"
metadata: 
  node_type: memory
  type: project
  originSessionId: 87b553ae-fcfd-4e40-8f37-d8e926f18961
---

Android Auto TTS media session support (#3919) merged in PR#4907. CarPlay counterpart blocked on Apple entitlement.

**Google Play rejection (2026-07-09):** the Android Auto review track rejected the release because the Auto TTS feature still has a bug (being fixed in a separate session). To unblock the resubmission, the Auto opt-in was removed from `src-tauri/gen/android/app/src/main/AndroidManifest.xml` in PR#5038 (MERGED 2026-07-09): the `<meta-data android:name="com.google.android.gms.car.application" android:resource="@xml/automotive_app_desc" />` entry inside `<application>`. The guard test `src/__tests__/android/android-auto-declarations.test.ts` now asserts the meta-data is ABSENT; flip those assertions back when re-enabling.

**How to re-enable once the bug is fixed:** re-add that meta-data entry. The resource `res/xml/automotive_app_desc.xml` was intentionally left in place (unreferenced but harmless), and the `MediaBrowserService` intent-filter on `com.readest.native_tts.MediaPlaybackService` also stays — it's required for the phone lock-screen/background TTS media session ([[android-bg-tts-media-session-fix]]) and does not by itself trigger Play's Android Auto review; only the `com.google.android.gms.car.application` meta-data does.
