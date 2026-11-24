---
name: macos-file-url-semicolon-encoding-7553
description: "macOS open-with file:// URLs encode ; as %3B (NSURL/CFURL); decodeURI leaves it; Swift URL does not encode it, so test with NSURL"
metadata:
  node_type: memory
  type: project
  originSessionId: 8a0e307c-8fc3-4c62-90a8-3ae1ffdd5b9d
  modified: 2026-11-17T16:04:12.640Z
---

#7553 (books named `X;.epub` didn't open from Finder or Calibre) was fixed by community PR #7554, merged as c26f46b30 on 2026-11-17. It added the `decodeFileUrlPath` helper in `src/helpers/openWith.ts`, which uses decodeURIComponent.

- The NSURL/CFURL that AppKit's `application:openURLs:` hands over encodes `;` as `%3B`. Swift's `URL(fileURLWithPath:)` leaves `;` raw, so a quick Swift check gives the wrong answer; use `NSURL(fileURLWithPath:)` or `CFURLCreateWithFileSystemPath` instead.
- The Rust `RunEvent::Opened` → `url.to_file_path()` path was already correct. Only the JS paths that ran `decodeURI` were broken.
- Not done: verifying the open in a full macOS app build. A possible sibling: `resolveNativeBookFilePath` (bookService.ts) still runs `decodeURI` on `file://` paths, which would matter only for iOS read-in-place books.
