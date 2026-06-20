---
name: save-image-to-gallery-android
description: Image-viewer Save button → Android MediaStore (not share); sharekit 0-byte self-copy bug; tsgo misses abstract conformance
metadata: 
  node_type: memory
  type: project
  originSessionId: d72184f1-0e4c-412b-9dc9-fb384e189427
---

PR #4680 — image gallery "Save Image" button (`ImageViewer.tsx` + `ZoomControls.tsx`).

**Routing (the button reflects the actual action):** `canShare = !isAndroidApp && canShareText(appService)`.
- Android → `appService.saveImageToGallery(filename, bytes, mimeType)` = new native-bridge command `save_image_to_gallery` (Kotlin `MediaStore.Images` insert into `Pictures/Readest`, scoped-storage = NO permission on API 29+; pre-29 best-effort). Writes a Temp `shared/<name>` staging file, passes its path, removes it after.
- iOS/macOS / web-with-`navigator.share` → `saveFile({share:true})`.
- desktop / web-no-share → saveDialog / download.

**WHY Android does NOT use the share sheet to "save to file":** Android `ACTION_SEND` only lists apps that *consume* content; NO file manager registers for it. Verified on device: `adb shell cmd package query-activities -a android.intent.action.SEND -t image/png` → 34 apps (Bluetooth/Gmail/WPS/Telegram/Xiaomi-Drive…), zero file managers. "Save to a folder" is `ACTION_CREATE_DOCUMENT` (system `com.google.android.documentsui`), which never appears in a share sheet. So on MIUI the share flow genuinely can't save-to-file.

**sharekit 0-byte self-copy bug (separate fix commit on #4680):** `@choochmeque/tauri-plugin-sharekit` (rust `tauri-plugin-sharekit 0.3`) `shareFile` copies src → `File(activity.cacheDir, sourceFile.name)` BEFORE `ACTION_SEND`. Tauri `Temp` dir IS `activity.cacheDir` = `/data/user/0/<pkg>/cache` (verified `invoke('plugin:path|resolve_directory',{directory:12})`). Writing the shared file to the Temp ROOT makes that a copy onto itself → `FileOutputStream` truncates the source to 0 before `copyTo` reads it → **0 KB shared file**. Fix = write to a Temp `shared/` SUBDIR in `nativeAppService.saveFile`. Also fixed the same latent 0-byte bug in annotation/markdown export.

**tsgo gap (bit me):** `pnpm lint` (tsgo) does NOT flag abstract-class interface conformance — adding a method to the `AppService` interface compiled clean under tsgo but the production Next `tsc` failed (`BaseAppService` missing abstract member). When extending `AppService`: add `abstract` decl in `BaseAppService` (appService.ts) + impls in native/web/**node**AppService + the 2 test stub classes (`app-service.test.ts`, `import-metahash.test.ts`). Run real `npx tsc --noEmit -p tsconfig.json` to catch.

**On-device verify recipe (no run-as on release APK):** `pnpm dev-android` (devtools APK) → CDP invoke `plugin:native-bridge|save_image_to_gallery` with a PNG staged via `plugin:fs|write_file` (body = Uint8Array 2nd arg, `headers:{path:encodeURIComponent(p),options:'{}'}`) → confirm with `adb shell content query --uri content://media/external/images/media --projection _display_name:relative_path:_size --where "relative_path='Pictures/Readest/'"`. Real 252 KB JPEGs from the live UI landed correctly. See [[android-cdp-e2e-lane]], [[cdp-android-webview-profiling]].
