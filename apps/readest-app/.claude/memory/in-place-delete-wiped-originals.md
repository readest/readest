---
name: in-place-delete-wiped-originals
description: "Deleting a \"Read books in place\" book from Readest used to permanently delete the user's original source file; fixed (PR #4696) to never touch external sources"
metadata: 
  node_type: memory
  type: project
  originSessionId: 432bbb95-47b4-4d9c-825b-528168e2cfb7
---

User report (v0.11.12 Windows): imported a folder via "Import From Directory" with **Read books in place**, later deleted the books in-app, and Readest **permanently deleted the original local files** (not even sent to Recycle Bin). Files were unrecoverable; cloud sync hadn't uploaded them yet ("Book File Not Uploaded").

**Root cause:** `deleteBook` in `src/services/cloudService.ts`. For `local`/`both`/`purge`, it called `resolveBookContentSource` (`src/services/bookContent.ts`) and, when `source.kind === 'external'` (i.e. `book.filePath` set, base `'None'` — the user's own file from an in-place or transient import), unconditionally `fs.removeFile(source.path, source.base)`. `book.filePath` is set in `bookService.ts importBook` whenever `transient || inPlace`.

**The trap:** this was NOT an accidental bug — it was **deliberately coded AND tested**. `cloud-service.test.ts` had a whole `in-place (book.filePath set)` describe block asserting the source file IS removed, with a comment rationalizing it as "symmetric with deleting Books/<hash>/<title>.epub for a normal book." Don't assume tested == intended; the maintainer reversed the decision.

**Fix (PR #4696):** never `removeFile` an `external` source. Only `managed` sources (our Books/<hash>/ copy) and app-generated sidecars (cover.png, and the whole Books/<hash>/ dir on `purge`) are Readest's to delete. Removed the `external` branch entirely; flipped the in-place tests to assert the source is preserved (cover sidecar still removed on `both`, sidecar dir still wiped on `purge`). Also fixed the misleading JSDoc in `ImportFromFolderDialog.tsx` (`readInPlace`) that documented the destructive behavior as intended.

Out of scope but noted in the support thread: deletion flow lacks a warning/disclaimer, and delete doesn't use the OS Recycle Bin. See [[bug-patterns]].
