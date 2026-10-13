---
name: purge-cloud-reading-data-6532
description: "#6532 Purge all reading data left cloud configs/notes + books.progress; MERGED #6536 (97ff4e744); Delete All Books deliberately NOT covered"
metadata:
  node_type: memory
  type: project
  originSessionId: d2aaefe3-4891-4236-840a-d15bd0a8d40e
  modified: 2026-10-01T18:10:15.746Z
---

"Purge all reading data" wiped only local `Books/<hash>/`; cloud `book_configs` / `book_notes` (keyed by user, no cascade) were pulled back on re-import, and the tombstoned `books` row kept `progress` (old % on the re-imported card).

Fix MERGED #6536 (97ff4e744, 2026-10-02): `src/services/purgeCloudBookData.ts` pulls the hash's config+notes, pushes notes with `deletedAt` and config with explicit `null` fields; runs before the local delete in `handleBookDelete('purge')`, which also sets `book.progress = null` (`Book`/`DBBook.progress` now `| null`). Exact book_hash only, so metaHash siblings keep notes.

- chrox DECLINED extending it to Delete All Books (`/api/user/library` still leaves configs/notes by design).
- `transformBookConfigToDB` uses `&&`, so explicit `null` survives (CodeRabbit claimed otherwise; refuted).
- Chrome verify trap: chrox's account syncs via OneDrive, so reader activity never hits `/api/sync`; seed rows via POST `/api/sync` with `localStorage.token` instead of changing sync settings.
- Local `tsc` (incremental) missed a type error CI caught; use `tsc --noEmit --incremental false` before pushing.
- Throwaway "Purge Test 6532" book (hash 867f6349…) left in chrox's library.
