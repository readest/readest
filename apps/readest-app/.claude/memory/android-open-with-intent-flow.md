---
name: android-open-with-intent-flow
description: "Android \"Open with/Send to Readest\" intent pipeline + why Telegram/cloud-app opens differ from file-manager opens (issue"
metadata: 
  node_type: memory
  type: project
  originSessionId: 73ee84b7-27a0-4232-981c-de8235a15f07
---

Android "Open with Readest" / "Send to Readest" file-intent pipeline and the #4521 ("open book from Telegram") diagnosis. Confirmed fixed by #4527.

**Pipeline (ACTION_VIEW = "Open with", ACTION_SEND = "Share"):**
- `NativeBridgePlugin.kt::handleIntent` is the real handler (NOT `MainActivity.kt` — its ACTION_SEND branch is legacy/redundant). → `emitSharedIntent("VIEW"|"SEND", uris)` → JS `useAppUrlIngress` `shared-intent` plugin listener → `app-incoming-url` event → `useOpenWithBooks`.
- VIEW → `openTransient` → straight to reader (ephemeral book, `deletedAt` set, `filePath` = the content:// URI, no library write/upload). SEND → `window.OPEN_WITH_FILES` → `library/page.tsx::processOpenWithFiles` (full ingest + force cloud upload on mobile).
- content:// read: `nativeAppService.openFile` → if URI contains `com.android.externalstorage` → direct `NativeFile` (real path); else `copyURIToPath` → `contentResolver.openInputStream` → copy to Cache → `NativeFile`. `basename` here is LEXICAL (`@tauri-apps/api/path`), not a ContentResolver `DISPLAY_NAME` query — but EPUB format is sniffed by zip magic (`document.ts isZip()`), so an extension-less content URI still opens.
- The Tauri deep-link plugin's `getCurrent()`/`onOpenUrl` only fire for configured deep-link domains (`https://web.readest.com`, `readest:`); `content://`/`file://` VIEW intents are filtered out by `DeepLinkPlugin.isDeepLink()`, so file opens flow ONLY through the native `shared-intent` channel, never the deep-link plugin.

**#4521 root cause (Telegram open fails, file-manager works) — TWO independent axes:**
1. **Cold-start delivery.** On cold launch the ACTION_VIEW intent reaches `handleIntent` before the JS `shared-intent` listener registers; upstream `Plugin.trigger()` drops events with no listener. **#4527** added queue+replay (`emitOrQueue`/`pendingEvents` + `registerListener` override) to fix it. **#4527 is on `dev` but NOT in released v0.11.4** (v0.11.4 has #4407 only) — the reporter's likely cause. Logs show `Queued shared-intent payload (no listener yet)` then `Replaying 1 queued event(s) after registerListener`.
2. **Foreign-private-file read.** File-manager/MediaStore opens point at SHARED storage → Readest reads via real path / MediaProvider FUSE (it holds `MANAGE_EXTERNAL_STORAGE`), so the URI grant is irrelevant. Telegram/Gmail/Drive serve an APP-PRIVATE file via their own FileProvider with a TEMPORARY, non-persistable grant (`takePersistableUriPermission` throws → caught) → readable only in-session via `openInputStream`; the transient book's `content://` filePath then breaks on later reopen once the grant dies.

**Verification gotcha (adb, no Telegram):** an adb MediaStore content-URI VIEW intent
`adb shell am start -a android.intent.action.VIEW -d content://media/external/file/<id> -t application/epub+zip --grant-read-uri-permission -n com.bilingify.readest/.MainActivity`
tests the pipeline (Axis 1) but CANNOT reproduce Axis 2 — shared-storage reads via FUSE bypass the grant, so it always succeeds. To reproduce the real failure use a foreign FileProvider source (Gmail/Drive/Outlook attachment "Open with Readest") or a tiny helper APK with its own FileProvider. Get the MediaStore `_id` via `adb shell content query --uri content://media/external/file --projection _id:_data | grep <name>` (MIUI `--where` chokes on `/storage/...` path tokens). Watch `adb logcat | grep -iE "NativeBridgePlugin|Open with FUSE|Failed to (open|import)|Queued|Replaying"`.

Critical files: `src-tauri/plugins/tauri-plugin-native-bridge/android/src/main/java/NativeBridgePlugin.kt`, `src/hooks/useAppUrlIngress.ts`, `src/hooks/useOpenWithBooks.ts`, `src/services/nativeAppService.ts::openFile`, `src/services/bookContent.ts::resolveBookContentSource`.
