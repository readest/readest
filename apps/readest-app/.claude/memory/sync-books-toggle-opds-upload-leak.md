---
name: sync-books-toggle-opds-upload-leak
description: "Verified: Manage Sync Books toggle does NOT gate OPDS-path uploads to Readest Cloud, and the /user panel renders from an un-hydrated settings store on direct loads"
metadata: 
  node_type: memory
  type: project
  originSessionId: 8aa19ceb-184d-4887-a696-aa65f9db85d7
  modified: 2026-08-17T09:01:35.977Z
---

User reports "Books off in Manage Sync but book files still upload to Readest Cloud".
Chrome-verified 2026-08-17 against dev-web on the real account. THREE distinct defects;
#1 MERGED #5759 (2026-08-17):
new `services/opds/cloudUpload.ts queueOPDSBookUploads(isLoggedIn, settings, books)`
checks `isSyncCategoryEnabled('book')` + provider gate, used by both OPDS sites;
tests in `__tests__/services/opds-cloud-upload-gate.test.ts` + hook tests. #2 and #3 UNFIXED:

**1. OPDS upload paths skip the Books category gate (live-reproduced).**
`src/app/opds/page.tsx` (~line 659, manual catalog download) and
`src/hooks/useOPDSSubscriptions.ts` (~line 76, subscription auto-sync) queue
`transferManager.queueUpload(book)` gated only on `user && isReadestCloudStorageActive(settings)`
— no `settings.syncCategories?.book !== false` check. With Books OFF, downloading
The Green Mummy from Gutenberg OPDS uploaded `Readest/Books/<hash>/The Green Mummy.epub`
to R2 and stamped `uploadedAt`. Subscription auto-sync runs unattended → likeliest
source of the field reports.

**2. `transferManager.isBookUploadAllowed()` checks provider only.**
It returns `isReadestCloudStorageActive(settings)` — no category check — so nothing
downstream catches ungated callers, and `reconcileUploadsWithProvider()` cancels
pending uploads only on provider switch, not on a Books toggle-off. Pending queue
entries from before a toggle-off still upload.

**Correctly gated (verified no upload with Books OFF):** normal library import —
`ingestService.ts` ~line 254 checks the category (with deliberate `forceUpload` for
Sent books); library metadata rows via `useSync.ts` ~286 and replica paths via
`isSyncCategoryEnabled`. Explicit per-book Upload / Upload All are ungated BY DESIGN.

**3. Manage Sync panel renders from an un-hydrated store on direct /user loads.**
`useSettingsStore` boots as `{} as SystemSettings`; only the library page, Reader,
OPDS page, and StorageManager (`useLibrary`) hydrate it — nothing on /user does.
Direct-load /user → panel shows every category at DEFAULT (Books ON) regardless of
disk; verified: disk `{book:false}` while panel showed Books ON. After client-side
nav from /library the same panel correctly showed OFF. Toggling from the divergent
state persisted a syncCategories that dropped the existing `credentials:false` key.
`SyncCategoriesSection.handleToggle` and `helpers/settings.ts saveSysSettings` both
spread-and-save whatever object is in the store — if the store were truly `{}` at
save time they would WIPE settings.json (didn't reproduce a full wipe; something
had partially hydrated by toggle time, but the class of bug is real).

**Doc rot:** `syncCategories.ts` header claims the category map "rides along the
bundled settings replica via the existing whitelist" — FALSE. `SETTINGS_WHITELIST`
in `services/sync/adapters/settings.ts` has no `syncCategories.*` entries; the map
is per-device only.

**Fix shape:** add the category check to both OPDS queue sites (or better, inside
`transferManager.queueUpload` / `isBookUploadAllowed` so every ingress is covered),
and hydrate settings from disk before rendering/saving on /user (e.g. `useLibrary`
or an explicit loadSettings+setSettings in the user page / EnvContext).

**Test-session residue on the real account (left in place deliberately):**
"Books Gate Test fa99c658" (2KB EPUB, local only) and "The Green Mummy" (Gutenberg,
file uploaded to Readest Cloud) remain in the library; user may delete via app UI.
syncCategories restored to book:true (semantically the pre-test state; the explicit
`credentials:false` entry is gone but credentials defaults OFF anyway).

Related: [[reference-page-count-sync-5716]] (book_configs no field-level merge),
[[multi-provider-cloud-sync-5062]] (provider routing), [[browser-verify-readest-web-recipe]].
