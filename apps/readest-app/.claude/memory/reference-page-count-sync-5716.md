---
name: reference-page-count-sync-5716
description: "#5716 referencePageCount never crossed devices and got erased from cloud; import stamped INIT_BOOK_CONFIG over an existing config.json"
metadata: 
  node_type: memory
  type: project
  originSessionId: 54679c09-5a1a-405b-a55c-56b60f74ea16
  modified: 2026-08-15T16:14:18.356Z
---

Issue #5716 (2026-08-15). **MERGED as PR #5727**, squash commit `1716d2724`; worktree and branch cleared. Two unrelated data-loss faults filed together. **Device verify still pending** -- nothing here was tested on two real signed-in devices, only in unit tests.

Push hit the [[ci-pr-delivery-and-push]] broken pipe again: the husky pre-push hook ran the full suite for ~4 min, the proxied SSH connection dropped mid-run, hook PASSED but the ref never transferred. `git ls-remote` returned empty. `--no-verify` on the re-push landed it (safe: same tree, hook had just passed). The `ServerAliveInterval` fix in `~/.ssh/config` does NOT cover a 4-minute hook.

**Fault 1: per-book `viewSettings` NEVER cross devices, on EITHER backend.**
- Readest cloud: `useProgressSync.applyRemoteProgress` applies ONLY `proofreadRules` out of a remote config's viewSettings. The load-bearing comment is right there: "other config fields remain device-local. TODO: general config sync".
- File sync (WebDAV/Drive/S3/iCloud/Dropbox): `buildRemotePayload` in `services/sync/file/wire.ts` strips viewSettings entirely. The `trimmed` object is the SOURCE OF TRUTH for what travels.
- But the cloud STILL STORES viewSettings in `book_configs.view_settings`, and `/api/sync` POST merges book_configs with **whole-row LWW** (`pages/api/sync.ts`, the `else if (clientIsNewer)` branch). Combined with `serializeConfig` stripping every setting equal to global, a peer that lacks the override pushes `view_settings = "{}"` and **erases it from the cloud**. `books` rows have field-level merge clocks (reading_status #4634, cover #4544, metadata #5438); `book_configs` has NONE.

Fix: `referencePageCount` is book data (the print edition's page count), not a device preference, so it gets a shared merge policy `resolveReferencePageCount` in `utils/progress.ts` called by BOTH backends. On the file-sync wire it rides its own top-level envelope key, NOT `config.viewSettings` -- `mergeBookConfig` spreads `config` wholesale, so a nested viewSettings would replace the peer's entire view settings object.

**A missing remote count must never clear a local one.** The wire cannot distinguish "user cleared it" from "peer running a build that predates this merge" (serializeConfig drops anything equal to the global default, and the default is 0). Clearing therefore does not propagate -- accepted, since wiping a number the user typed is the worse failure.

**Normalize BOTH sides of the equality check** (`?? 0`). An unset key and `0` both mean "no count"; comparing raw rewrites viewSettings and bumps `updatedAt` on EVERY book open. Caught only because an existing proofread test asserted no writes.

**Fault 2: `importBook` guarded the INIT_BOOK_CONFIG write on the LIBRARY RECORD, not the file.** The comment said "Never overwrite the config file only when it's not existed" but the code was `if (!existingBook)`. Any book whose `Books/<hash>/` already held a config.json but whose library.json row was missing lost position + bookmarks + annotations. `restoreBackup` walks straight into it: for a hash dir the archive's library.json does not list, it extracts the dir (config.json included) and THEN calls `importBook`. A lost/reset library.json puts every book in the same state. Fix = `fs.exists(getConfigFilename(book), 'Books')`. Same hash means same bytes, so an existing config always belongs to that book.

Reporter's step 9 ("open on device A again, the count is gone") is NOT reproducible from the code -- A keeps its local copy; only the cloud row is erased. The issue body reads AI-drafted; verify claims against code, do not inherit the narrative.

**Review round 1 (CodeRabbit, valid).** The two callers of the shared `resolveReferencePageCount` passed DIFFERENT tie predicates: `merge.ts` `>=`, `useProgressSync.ts` `>`. Fixed to strict `>` on both in `28066de8c` (local count wins a tie). Left the scalar spread in `mergeBookConfig` on `>=` -- changing it would alter progress/location LWW for every file-sync user.

**The tie is the STEADY STATE, not a rare race:** a remote-wins `mergeBookConfig` copies `remote.updatedAt` onto the local config, so every later pull of an unchanged remote ties. No user-visible divergence was reproducible (the same merge adopts the count in lockstep with the timestamp, and `saveConfig` always stamps a fresh `updatedAt`), but a shared merge policy whose callers derive the predicate differently defeats its own purpose. Extracting a shared helper does NOT make backends consistent if each caller computes the comparison itself -- pin it with a paired test on BOTH sides.

Related: [[sync-fixes]], [[sync-deleted-at-cursor-invariant]], [[bug-patterns]]
