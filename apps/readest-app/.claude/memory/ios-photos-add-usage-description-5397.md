---
name: ios-photos-add-usage-description-5397
description: "#5397 iOS crash saving image to Photos — missing NSPhotoLibraryAddUsageDescription; 'Save to Photos' is WebKit's menu, not Readest code"
metadata: 
  node_type: memory
  type: project
  originSessionId: 1a8ff711-76a2-40fc-9a5e-22cfb0baea37
  modified: 2026-07-31T06:57:38.514Z
---

#5397 (2026-07-30, iOS 26.1, v0.11.20): app is SIGKILLed by TCC on "Save to Photos".
Crash log thread 19: `PHPhotoLibrary _performCancellableChanges` ->
`PHPerformChangesRequest determineAuthorizationStatusForChanges` ->
`PLPrivacy checkPhotosAccessAllowedWithScope` -> `__TCC_CRASHING_DUE_TO_PRIVACY_VIOLATION__`.
Fixed by adding `NSPhotoLibraryAddUsageDescription` to `src-tauri/Info-ios.plist`
(+ guard test `src/__tests__/ios/photo-library-add-usage-description.test.ts`).
MERGED #5405 (a21d4a43b). NOT device-verified — no iOS hardware in that session; confirm on a
real build that the permission prompt appears and that "Save Image" now shows in the share sheet.

**Why "Save to Photos" is not findable in the repo:** it is not Readest's menu. It is
WebKit's native long-press image callout in WKWebView (`_WKElementActionTypeSaveImage`,
labeled "Add to Photos"/"Save to Photos"). Readest suppresses that callout via
`-webkit-touch-callout: none` on `img` in `getPageLayoutStyles` (`src/utils/style.ts`)
and `.no-context-menu` in `ImageViewer.tsx` — but that only covers the reflowable
(EPUB) iframe stylesheet, so the fixed-layout/PDF path can still surface it. UNVERIFIED
which path the reporter hit; the plist fix covers both.

**Why the maintainer only saw "Save to shared album" + "Save to Files":** that is
Readest's OWN share sheet (ImageViewer save button -> `appService.saveFile(..., {share:true})`
-> `UIActivityViewController`). iOS hides the built-in `UIActivityTypeSaveToCameraRoll`
("Save Image") activity when the bundle lacks `NSPhotoLibraryAddUsageDescription`; the two
remaining entries are out-of-process share extensions that need no host-app TCC declaration.
So the missing key both hid the working path and crashed the WebKit path.
Prediction to confirm on a rebuild: "Save Image" now appears in that sheet.

Add-only scope is correct — Readest never READS the library. The image picker
(`packages/tauri-plugins/plugins/dialog/ios/.../DialogPlugin.swift` `PHPickerConfiguration`)
is out-of-process and needs no `NSPhotoLibraryUsageDescription`.

**Where iOS plist edits go:** the tracked seed `src-tauri/Info-ios.plist` only. Verified in
the vendored CLI (`packages/tauri/crates/tauri-cli/src/mobile/ios/{build,dev}.rs`): every
`tauri ios build`/`dev` runs `merge_plist([gen/apple/Readest_iOS/Info.plist,
src-tauri/Info.plist, bundle.iOS.infoPlist])` and writes the result back to the generated
path — so the seed always lands, and edits to the gitignored generated plist are pointless.
See [[carplay-tts-support]].
