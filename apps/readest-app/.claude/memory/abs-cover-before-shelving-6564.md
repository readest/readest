---
name: abs-cover-before-shelving-6564
description: "ABS audiobooks adopted from Readest Cloud shelved with placeholder covers; fixed in PR #6564; useBooksSync test trap with *Once mocks"
metadata:
  node_type: memory
  type: project
  originSessionId: d2aca210-9d1d-4161-98bd-89b3ffb02195
  modified: 2026-10-02T16:05:08.977Z
---

ABS (Audiobookshelf) books adopted via Readest Cloud have no cover in cloud storage, so `useBooksSync` shelved them with placeholder tiles until the next `backfillAbsCovers`. Fix: `processNewBook` awaits `fetchAbsBookCover` (extracted from the backfill loop in `services/audiobookshelf/librarySync.ts`) before shelving, with a call-site `.catch`, because its `exists`/`resolveFilePath` sit outside `downloadAbsCover`'s catch and a throw rejected the batch `Promise.all`, dropping every new book in the pass. MERGED #6564 (2e0b689f3) 2026-10-03, UNRELEASED, not device-tested.

**Test trap:** in `abs-books-sync.test.tsx` the hook runs `updateLibrary` more than once, so a `mockImplementationOnce`/`mockRejectedValueOnce` only governs the first run and the second (default mock) run shelves the book anyway. Tests pass vacuously. Use `mockReturnValue(sharedPromise)` / `mockRejectedValue` and reset the default in `beforeEach` (`vi.clearAllMocks` does not reset implementations).

**Why:** cost a red/green cycle during the CodeRabbit nitpick fix.
**How to apply:** any useBooksSync hook test that mocks a per-book async step must mock every call, then confirm red by breaking the code.

Related: [[sync-fixes]]
