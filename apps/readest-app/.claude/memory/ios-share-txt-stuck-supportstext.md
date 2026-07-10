---
name: ios-share-txt-stuck-supportstext
description: iOS sharing a .txt to Readest hung the share sheet; Share Extension NSExtensionActivationSupportsText captured plain-text files
metadata: 
  node_type: memory
  type: project
  originSessionId: 445ce295-90f6-4ed2-8227-e25b1e0a876d
---

Sharing a `.txt` file to Readest via the iOS share sheet got **stuck**, while EPUB/PDF worked. Root cause: the **Share Extension** (article-URL clipper, added #4256/#4267) wrongly activated for `.txt`. FIXED, **PR #4917 merged** (`fix/ios-share-txt-stuck`).

- `ShareViewController.swift` only ever extracts an `http(s)` URL. Its activation rule (`project.yml`) had `NSExtensionActivationSupportsWebURLWithMaxCount: 1` **and `NSExtensionActivationSupportsText: true`**.
- A `.txt` is UTI `public.plain-text`, which **conforms to `public.text`** → satisfies `SupportsText` → the URL-only clipper activates for a file it can't handle → sheet hangs (for a file-backed provider `loadItem(public.plain-text)` returns a file `URL`, so `loadText`'s `as? String`/`as? Data` both fail → no URL → neither completes nor cleanly cancels).
- EPUB (`org.idpf.epub-container`) / PDF (`com.adobe.pdf`) conform to neither text nor web-URL, so they never match the extension and take the **main app** `CFBundleDocumentTypes` "Copy to Readest" open-in-place path (`Readest_iOS/Info.plist`), which imports via `useOpenWithBooks.ts` → `importBook` (format-agnostic; txt→epub via `TxtToEpubConverter`). `.txt` is ALSO declared there, so it imports fine once the extension stops stealing it.

**Fix (option A):** remove `NSExtensionActivationSupportsText: true`; keep web-URL only. Safari/Chrome "share page" still sends `public.url`, so article clipping is preserved. Only regression: sharing a raw text *selection* containing a link no longer triggers the extension (minor).

**Source-of-truth gotcha:** `src-tauri/gen/apple/project.yml` is the **xcodegen** source; Tauri's iOS CLI runs `xcodegen` at build time (`tauri-cli/src/mobile/ios/project.rs`) and REGENERATES each target's `Info.plist` from it. The committed `ShareExtension/Info.plist` is a generated artifact marked **`skip-worktree`** (`git ls-files -v` → `S`) — local edits to it are invisible to git and it stays stale at HEAD. So: fix `project.yml` ONLY; a test asserting on the committed plist would pass locally but FAIL on a fresh CI checkout. Regression test lives at `src/__tests__/ios/share-extension-activation-rule.test.ts` (asserts on `project.yml`, strips `#` comments first since the warning comment names the key). Test precedent: `src/__tests__/android/*declarations*.test.ts` read native config via `resolve(process.cwd(), 'src-tauri/...')`.
