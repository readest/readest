---
name: ios-txt-share-sheet-tauri211-fileassoc
description: 0.11.20 regression - iOS Files/share sheet lost Readest for .txt; tauri-cli 2.11 fileAssociations clobber hand-tuned CFBundleDocumentTypes
metadata: 
  node_type: memory
  type: project
  originSessionId: e379ef9f-2d09-4346-8019-ca92644ba023
  modified: 2026-07-31T16:37:02.304Z
---

Regression in 0.11.20 (vs 0.11.18): iOS Files preview/share sheet no longer offers Readest for `.txt`; EPUB/PDF unaffected. MERGED PR #5415 (2026-07-31): txt AND md added to `bundle.fileAssociations` + guard test `src/__tests__/ios/txt-file-association.test.ts`. Device verify pending (needs TestFlight/device build). Worktree and local branch cleaned up. md was regressed too (net.daringfireball.markdown conforms to public.plain-text, so it rode on the lost claim); md gets an extension-only entry (no UTI in tauri-utils mapping), which works like epub's.

- The CarPlay commit `58d4661b7` (#5085, 2026-07-13, between the tags) bumped `@tauri-apps/cli` 2.10.1 → 2.11.4.
- tauri-cli **2.11.0 added mobile file associations** (tauri PR #14486, commit cc5c97602): at build time it now generates iOS `CFBundleDocumentTypes` from `bundle.fileAssociations` and `plist.insert()`s the key — **replacing** the hand-tuned `CFBundleDocumentTypes` merged from `src-tauri/Info.plist` (which carried the `Text File` / `public.plain-text` claim). Other hand-tuned keys (UTImported/UTExportedTypeDeclarations, usage descriptions) survive; only keys the generator emits get clobbered.
- `bundle.fileAssociations` in `tauri.conf.json` lists epub/mobi/azw/azw3/fb2/cbz/pdf but **no txt** → shipped 0.11.20 app no longer claims `public.plain-text` → iOS drops Readest as a .txt handler. EPUB/PDF are in fileAssociations, so they kept working.
- `gen/apple/Readest_iOS/Info.plist` is gitignored and regenerated+merged by the CLI on every build (`src-tauri/gen` in .gitignore); the project.yml comment calling it "hand-tuned on disk" is misleading — the durable sources are `src-tauri/Info.plist`, `src-tauri/Info-ios.plist`, and the CLI generator. So on iOS the hand-tuned `CFBundleDocumentTypes` in `src-tauri/Info.plist` is now dead code.
- tauri-utils maps `text/plain`/`txt` → `public.plain-text` and `application/pdf` → `com.adobe.pdf` (`mime_type_to_uti`/`extension_to_uti`); epub etc. get extension-only entries (still work on iOS via UT declarations).

**Fix:** add `{ name: txt, ext: [txt], mimeType: text/plain, role: Viewer }` to `bundle.fileAssociations` → CLI emits `LSItemContentTypes: [public.plain-text]` on iOS. Side effect: Windows/Linux installers will then also register .txt associations (macOS keeps hand-tuned array — bundler merges user Info.plist last there). Guard with a unit test on tauri.conf.json fileAssociations (precedent: `src/__tests__/ios/share-extension-activation-rule.test.ts` asserting on native config files).

**Pattern to remember:** any future hand-tuned Info.plist key that tauri-cli learns to generate will be silently clobbered on iOS at the next CLI bump. Related: [[ios-share-txt-stuck-supportstext]] (the .txt share-sheet path history), [[ios-photos-add-usage-description-5397]] (Info-ios.plist merge).
