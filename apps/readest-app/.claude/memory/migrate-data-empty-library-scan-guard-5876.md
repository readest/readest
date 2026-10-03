---
name: migrate-data-empty-library-scan-guard-5876
description: "#5876 Change Data Location silently did nothing on an empty library; the file-count guard that caused it was also the only thing stopping a failed directory scan from wiping the data dir. MERGED #5878"
metadata:
  node_type: memory
  type: project
---

**Issue #5876:** with an empty library (e.g. right after clearing app data), Change Data Location -> Choose New Folder -> Start Migration created the new folder but never persisted it. The app kept using the old location.

**Root cause:** `handleStartMigration()` in `src/app/library/components/MigrateDataWindow.tsx` early-returned on `!filesToMigrate.length`. An empty library makes that list legitimately empty, so the function aborted before reaching `setCustomRootDir` + `saveSettings`. The folder itself is created earlier, in `handleSelectNewDir` / `handleSelectedNewDir`, which is why the folder existed but the setting never moved.

**The trap (found in review of the contributor's PR, not in the original report):** that same file-count check was doing double duty. It also stood in for "the directory scan succeeded". `loadCurrentDataDir()` swallows a `readDirectory` rejection in its `catch` and leaves `filesToMigrate` at `[]` while `currentDataDir` is already set (it is assigned BEFORE the scan). Dropping the count from the guard alone would let a failed scan through: copy loop 0 iterations, verify loop 0 iterations, then `appService.deleteDir(currentDataDir, 'None', true)` recursively wipes the real data directory having copied nothing.

`readDirectory` genuinely rejects here. `library/page.tsx` already documents the reasons: revoked storage permission, path outside the Tauri `fs_scope`, an iOS file-provider path, a directory that went away. Those are exactly the states in which someone opens Change Data Location to dig themselves out.

**Fix (MERGED #5878, squash `aa619f8f8`):** a `dirScanned` flag, set `false` at the top of `loadCurrentDataDir` and `true` only after the scan completes, now gates both the guard and `canStartMigration`. An empty library migrates; an unreadable one does not, and the Start Migration button is disabled rather than dead on click. The two states were already distinguishable in the UI (`File count: 0` vs a permanent `Calculating file info...`), the signal just was not gating anything.

**Generalizable pattern:** before deleting a guard that looks like a redundant emptiness check, ask what else it was implicitly asserting. An empty collection can mean "genuinely empty" or "we failed to look", and any destructive step downstream needs those kept apart. Same family as [[in-place-delete-wiped-originals]] and [[gdrive-delete-locally-wiped-cloud-5084]]. See [[bug-patterns]].

**No unit test:** `MigrateDataWindow` is only drivable through a fully mocked `appService`, so a test would pin a call sequence over mocks. The contributor's original PR added exactly that and it was removed on request. See [[feedback-no-mock-only-platform-tests]].
