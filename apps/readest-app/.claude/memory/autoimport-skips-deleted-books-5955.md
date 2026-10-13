---
name: autoimport-skips-deleted-books-5955
description: "#5955 did NOT reproduce; the watched-folder scan permanently and silently skips any file whose book row was deleted, which matches the reported symptom"
metadata:
  type: project
---

Issue #5955 ("not all books are being imported"), Android + read-in-place + watched folder.
CLOSED 2026-08-30 as not-planned with the findings below posted for the reporter; reopen if they
confirm the two PDFs were never imported and deleted before.
Device-verified on the Xiaomi 13 (368b0948) against the reporter's OWN files, on Readest **0.12.6 —
the exact version they run**. Repro archive: `/Users/chrox/Documents/books/issues/5955/`.

**The reported recipe does NOT reproduce.** Registered an empty watched folder (read-in-place +
auto-import), dropped the reporter's `Polyeleos Triadika` folder in, backgrounded and foregrounded
Readest: the library went **75 -> 81, all six PDFs imported**, including the two titled `document`.
Their duplicate-detection theory is dead twice over — the six also have distinct partialMD5 AND
distinct metaHash (the #5411 PDF filename salt, shipped in v0.12.1, keeps the two `document` files
apart: `6179cfd6…` vs `4ec20fe5…`).

**What DOES reproduce the symptom exactly:** delete a book from the library while its file stays in
the watched folder. 81 -> delete 1 -> 80; file still on disk; background+foreground rescan -> still
80, forever. `collectKnownSourcePaths` (`src/services/bookService.ts`) deliberately includes
soft-deleted books AND their `altFilePaths`, "so that auto-import does not resurrect a book the user
intentionally removed". A manual import of that same file still works — which is precisely what the
reporter described.

**Why:** the behaviour is intentional but completely invisible. Nothing tells the user why those
files never appear, there is no UI to inspect or clear the tombstone, and the auto-import run is
called with `{ silent: true }`, so even genuine import failures raise no toast. Two of six files
silently missing looks like a dedupe bug and is not one.

**How to apply:** before touching dedupe logic for a "not all books imported" report, ask whether
those books were ever deleted from the library. The fix worth having is visibility (say what the
scan skipped and why), not a change to the skip rule. See [[duplicate-book-calibre-uuid-5959]] for
the neighbouring dedupe work and [[feedback-always-verify-on-xiaomi]] for the device recipe.
