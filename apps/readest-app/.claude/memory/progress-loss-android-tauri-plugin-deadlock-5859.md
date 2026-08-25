---
name: progress-loss-android-tauri-plugin-deadlock-5859
description: "#5859 Boox/Android 'progress goes back after the app restarts' -- DEVICE-REPRODUCED on a Boox Leaf5: the ~1.5s debounced config.json save is a loss window, and Boox background-kill + WebView timer throttling routinely kill the app inside it. NOT the Tauri plugin deadlock."
metadata:
  node_type: memory
  type: project
  originSessionId: 2890e387-8cc1-44b8-9dc0-e63bce545386
  modified: 2026-08-25T06:28:27.446Z
---

Issue #5859 (2026-08-24, rjrjr, Boox Go7, 0.12.1, single device):
after the app "restarts" it is a few pages / chapters back, once reset to page one.

## FIX IMPLEMENTED (2026-08-25, PR #5866, branch fix/reading-progress-loss-5859)
Two changes, both in the worktree; full suite green (10067 pass), lint clean.
1. **Identity gate (root fix)** in `services/opds/autoDownload.ts::downloadAndImport`: before
   downloading, `findBookByOPDSSources({catalogId, sourceUrls:[url], library})` — if the OPDS
   source already maps to a LIVE book, return it and SKIP re-download. Stops a re-packaged
   (different-bytes, same-content) re-download from minting a new book_hash. `findBookByOPDSSources`
   already existed in `sourceMap.ts` but was NEVER wired into the flow (only `upsert` was). Look up
   under BOTH `catalog.contentId` AND `catalog.id`: contentId is backfilled "at next save", so a
   source imported before backfill is keyed on id while later syncs key on contentId — matching one
   only would miss and re-import. DEVICE-VERIFIED on the Boox Leaf5 vs live CWA: edit book title on
   CWA (changes bytes) -> clear knownEntryIds -> relaunch -> auto-download: NO new duplicate row
   created (pre-fix each cycle made a fresh page-1 duplicate). NOTE the verify first showed a FALSE
   miss purely because the test catalog was INJECTED into settings.json without a contentId, then
   the app backfilled one between the old imports (keyed id) and the run (keyed contentId) — which is
   exactly the real-user window the both-keys lookup now covers.
2. **applyRemoteProgress reconciliation (safety net)** in `app/reader/hooks/useProgressSync.ts`:
   replaced the blind `matches.filter(bookHash||metaHash)[0]` pick with provenance-scoped, forward-
   only selection. The exact same-book_hash config applies its CFI/xpointer (valid in this file);
   same-metaHash SIBLINGS (different bytes) contribute ONLY their reading FRACTION via goToFraction,
   NEVER their CFI — because a sibling CFI can silently mis-resolve to a section start (see below) and
   because `[0]` (newest updated_at) could be a lower-progress/cross-file config, moving the reader
   backward. Furthest-forward wins (`SIBLING_FORWARD_EPSILON=0.002` guards pagination jitter). Could
   NOT be device-verified (the Leaf5 isn't signed into Readest cloud, so no config pull fires there) —
   covered by the full suite + logic; a signed-in two-hash device test is the remaining verify.

**Unresolvable-sibling-CFI -> page one (confirmed in foliate, the likeliest OP symptom):**
`view.goTo(siblingCFI)` on a CFI whose nodes don't exist in the current file does NOT throw —
`epubcfi.js toRange` returns null (line 319/catch), paginator `#goTo` does `anchor(doc) ?? 0` ->
scrolls to offset 0 = the section START (page one when the spine index is early). `#canGoToIndex`
only blocks out-of-range indices. Production data proves the trigger: the same reading position is
stored under DIFFERENT spine indices across siblings (/6/10 vs /6/8 for the same chapter-2), so a
sibling CFI mis-resolves. This is why reconciliation must never apply a sibling CFI.

## PRODUCTION DATA (rjrjr@pobox.com, Supabase readest.supabase.co, 2026-08-25) — the real signature
Queried with SUPABASE_ADMIN_KEY (in apps/readest-app/.env.local; host+key via createSupabaseAdminClient;
auth schema NOT exposed to PostgREST, so map email->id by paging `sb.auth.admin.listUsers` -- 176k users,
rjrjr id 81dc6a3a-1d1d-4ea8-b50e-f7fcc42bf312). KEEP LOCAL ([[feedback-no-prod-metrics-in-public]]).
- `books`: 333 rows (187 live / 146 deleted). **36 duplicate-title groups, EVERY ONE same meta_hash /
  different book_hash.** So this user's dupes are NOT metaHash-change forks -- the FILE BYTES change
  (new partialMD5 hash) while title/author/identifier stay constant. Their real calibre-web
  (Calibre-Web Automated) DOES serve byte-varying files over time (re-convert / enforce-metadata /
  cover-embed re-processing). This OVERTURNS the metaHash-change theory for the actual reporter (that
  was only my synthetic on-device repro).
- `book_configs`: 40 rows, ALL carry a location, ZERO deleted -- but 146 books are deleted. Configs
  accumulate while books churn. The reading position is SPREAD ACROSS MANY HASHES for one book: a
  340pp book has 6 configs marching 92->94->95->184->338 over 5 days, each under a DIFFERENT hash;
  another book regressed 383->380 across two hashes.
- Cross-ref: of 30 distinct READ books (metaHash with a saved location), **~21 have NO LIVE book row
  at all** -- the position is stranded on deleted hashes; the current library entry (a fresh
  re-download) has no/older config -> opens at page 1. THIS is the "reset to page one" in the data.

**Refined root cause:** OPDS auto-download re-imports the same book under a NEW book_hash every time
CWA's served bytes change; importBook (metaHash-match path) migrates the config to the new hash and
retires the old book, but the migration is lossy/laggy and the cloud never deletes old configs, so
progress fragments across many hashes and the live library row often ends up at page 1. The
metaHash-change INIT path (my repro) and this same-metaHash hash-churn are two faces of ONE root:
re-download -> new hash -> re-import. **The fix must give an OPDS book a STABLE identity across
re-downloads** (gate `downloadAndImport` on the source->hash map in `sourceMap.ts`; keep the same
hash / never re-import an already-mapped source), which kills the churn for both shapes.

## PRIMARY ROOT CAUSE (device-reproduced end-to-end 2026-08-25): OPDS auto-download re-import
The reporter loads books via OPDS from Calibre-Web Automated (CWA) with auto-download ON.
Confirmed on a Boox Leaf5 against a live CWA (http://192.168.2.3:8083, admin/admin123) with
the real app driving `syncSubscribedCatalogs -> downloadAndImport -> importBook`:
- **Identical re-download is SAFE.** Downloading the same book twice from CWA is byte-identical
  (same md5). Cleared `knownEntryIds`, relaunched -> re-import kept the same hash, hit the
  `!fs.exists(getConfigFilename)` guard (bookService.ts:764), progress preserved (page 7/170,
  no duplicate). `mergeBooks` returns undefined when there are no duplicates (bookService.ts:362),
  so no config rewrite. So a plain re-download does NOT reset -- do not blame "calibre serves
  different bytes per fetch" (it does not).
- **A server-side metadata change RESETS.** Edited the book's title via CWA
  (`POST /ajax/editbooks/title`, needs Flask login cookie + `X-CSRFToken`) -> CWA **rewrites the
  stored EPUB** (new bytes = new hash, new `<dc:title>` = new metaHash). Cleared `knownEntryIds`,
  relaunched -> auto-download re-fetched the CHANGED file -> `importBook` found no match by hash
  or metaHash -> `!existingBook` branch stamped `INIT_BOOK_CONFIG` and created a DUPLICATE:
  old row `facd4a96b9` "爱的艺术" metaHash 5c1fe0d9 progress [7,170] STRANDED; new row
  `56412c50a1a4` "爱的艺术（修订版）" metaHash 84dc1466 config `{location:null,updatedAt:0}` = page 1.
  `upsertOPDSSourceMapping` repoints the catalog to the new hash; the fresh row sorts to the top
  -> the user opens the page-1 copy. This IS the "reset to page one."

**metaHash = md5(title | authors | identifiers)** (utils/book.ts:461), computed from the
DOWNLOADED FILE'S OWN OPF (foliate parse), NOT the OPDS feed <title>. So a DB-only edit that
does not rewrite the file would NOT reset; the reset needs the served file to actually change.
**Two reset shapes** (see unit repro `__tests__/services/opds-reimport-config-reset.test.ts`,
all 4 pass): (3) new metaHash -> new INIT book + duplicate; (4) same metaHash but old config
missing at migration -> INIT. Same-metaHash-different-bytes with old config present MIGRATES
(progress kept, but the book's hash changes -> its own cross-device-sync churn).

**Likely "basically every book" amplifier (unverified):** CWA auto-ingest re-processing that
re-embeds metadata / assigns new calibre UUIDs. `identifiers` feeds metaHash and the calibre
`<dc:identifier scheme="calibre">` is in the OPF, so a re-ingest that changes the UUID changes
metaHash for EVERY re-processed book -> every one resets on the next auto-download. Confirm by
checking `getPreferredIdentifier` picks the calibre/uuid identifier and whether CWA re-ingest
rotates it.

**Trigger needs BOTH:** the served file changed AND a re-download fires. Re-download fires only
when the feed entry id (`urn:uuid`, stable for a title edit) is NOT in `knownEntryIds` -- i.e.
`pruneKnownEntryIds` LRU eviction (MAX_KNOWN_ENTRIES) or a NEW entry id from CWA re-ingest. In
the repro I forced it by clearing `OPDS/<catalogId>.json` (base Data = AppData/Readest/OPDS/).

**Fix directions (not yet implemented):** (a) gate `downloadAndImport` on the OPDS source->hash
map (`sourceMap.ts`) so an already-imported source is skipped, not re-imported; (b) never let
re-import stamp INIT over/beside a read book -- adopt an existing same-title/author config even
across a metaHash change, and never fall through to INIT when any candidate config is readable.

**Device/CWA recipe:** inject an auto-download catalog straight into `settings.json`
`opdsCatalogs` via the fs plugin over CDP (`plugin:fs|write_text_file` with body =
`TextEncoder().encode(json)`, headers `{path:encodeURIComponent(p), options:JSON.stringify({baseDir:13})}`),
point `url` at a single-book feed (`/opds/books/letter/<letter>` or `/opds/search/<term>`), then
force-stop+relaunch (startup fires `useOPDSSubscriptions`). Boox Leaf5 = adb ec8fafd, CDP 9224;
library at default `/data/user/0/.../Readest/Books` (fs plugin baseDir 14, NOT plain adb).
Device left with the `5859repro` catalog + two 爱的艺术 rows for fix-testing; CWA title reverted.

## SECONDARY (separate, real; FIX BUILT + device-verified, not yet a PR): background-kill save window
A distinct, smaller loss window, orthogonal to the OPDS cause above. FIX in worktree
`fix/android-progress-save-on-hide-5859`: flush `saveConfig` to disk on `visibilitychange:hidden`
+ `pagehide` in `useProgressAutoSave` (extracted `persistProgress`, stable ref). Unit tests added
(`__tests__/hooks/useProgressAutoSave.test.tsx`, 9 pass); full suite 10063 pass; lint clean.
Device-verified on the Boox (Test E): turn -> sleep -> kill +2s -> reopen KEEPS the new page
(pre-fix reverted). Does NOT address the OPDS reset (orthogonal).

**DEVICE REPRODUCED 2026-08-25 on a Boox Leaf5 (adb ec8fafd, ONYX, Android 13, WebView 148;
dev APK with devtools installed over the 0.12.1 store build).** The driver is the LOCAL save
window, not sync. Book "Demian" hash 1e8ec7e4a3e735fb75eceabc93f83923. Boox library root is
DEFAULT `/data/user/0/com.bilingify.readest/Readest/Books` (no customRootDir -> read via fs
plugin baseDir 14/13; the Xiaomi differs: customRootDir=/storage/emulated/0/Books, plain adb cat).

**Root cause (confirmed by repro + code):** the per-book config.json disk write is debounced in
`useProgressAutoSave.ts` -- `debounce(fn,1000)` whose fn does `setTimeout(saveConfig,500)` = ~1.5s
after the LAST page turn, and it early-returns if `location === lastSavedLocationRef`. There is NO
flush of THIS debounce on background/hide: the unmount effect only flushes the library.json rollup
(`flushPendingLibrarySave`), and `handleCloseBooks` (beforeunload/quit-app) + the `sync-book-progress`
close event only fire on graceful close. Android sleep / HOME / a background SIGKILL fire NONE of
those -- only `visibilitychange:hidden`. FoliateViewer commits the relocate to the IN-MEMORY config
synchronously when hidden (`commitRelocate` guard) but never forces the DISK write. So on Android the
only thing that persists config.json is the debounce firing before the OS kills the process. Boox
power management kills backgrounded apps aggressively AND Chromium throttles hidden-tab timers, so
that window is routinely missed. On relaunch (openLastBooks / deep link) the reader restores the last
FLUSHED config.json, which lags the true position by the final unsaved burst.

**Repro matrix (Boox), disk = config.json via CDP each step:**
- Sleep 60s / 180s, reader open: HELD (process survived; `anchor` re-render on wake kept the page).
- Background force-stop AFTER waiting 3s for the save: HELD; cold relaunch + reopen correct.
- Screen-off, read config.json ~12s later while still asleep: the debounced save HAD fired -> a slow
  natural sleep is usually safe.
- TEST B (LOST 1 page): turn 1 page, `am force-stop` +400ms (inside debounce, foreground) -> reopen on
  the previous page.
- TEST D (LOST 6 pages = "a few pages back"): 6 `view.next()` 350ms apart (each < the 1000ms debounce,
  so it keeps resetting) then force-stop +300ms -> config.json never advanced; all 6 lost.
- TEST E (LOST, the true reporter flow): turn 1 page, KEYCODE_SLEEP at +200ms, force-stop at +2.0s ->
  lost. Backgrounding throttles the timer so the ~1.5s debounce does NOT fire within ~2s of hiding.
- Deadlock stress (12 rounds: main-frame navigations + `plugin:path` IPC bursts, 6s liveness probe
  each round): NO wedge; IPC always < 25ms. The Tauri plugin-store deadlock (ANRs READEST-19B 540ev,
  READEST-18Y 253ev; both `shouldOverride`/`extend_api`) is REAL but does NOT drive #5859 -- do not
  attribute the progress loss to it. Prior draft of this memo over-weighted the deadlock; the device
  says the save window is the cause.

**Not yet reproduced:** "reset to page one." Needs config.json with no `location` (first-ever save of a
freshly openLastBooks-reopened book lost before it wrote, or the 0.12.1 importBook INIT wipe #5716 that
#5727 fixed AFTER 0.12.1). "Chapters" needs sustained fast flipping (Test D scaled up) or a longer
background-throttle freeze. Cloud is not the cause: the forward-only gate never moves the reader back,
and on this device (not signed in) the loss reproduced with sync entirely out of the picture.

**Fix direction (not implemented):** persist config.json on `visibilitychange:hidden` / `pagehide`,
bypassing the debounce -- call `saveConfig` directly (like `handleCloseBooks`) or add `saveBookConfig.flush()`
plus make the write not sit behind another 500ms setTimeout. In-memory config is already correct on hide,
so this is a straight "flush to disk when we lose foreground" fix. Optionally shorten/cancel the inner
500ms and mirror location to localStorage as a write-ahead.

**Sync gate is sound (code):** `useProgressSync.ts:280-312` only `view.goTo`s when `CFI.compare(local,remote)<0`
(fraction fallback also forward-only); a remote behind local is discarded, never persisted. No cloud
resume/visibility re-pull exists (open, close, manual Sync only). The OP's "confirm before moving back"
dialog is unnecessary.

**CDP/device recipe:** scratchpad `cdp.mjs` (eval/key/tap over `webview_devtools_remote_<pid>`),
`devcfg.mjs` (reads settings.json + a book's config.json through the app's own fs plugin, handles
customRootDir vs default baseDir), `boox.sh` / `repro.sh` wrappers, `deadlock.mjs` (IPC-race + liveness
probe). Boox CDP on local port 9224, Xiaomi on 9223. Dev APK `pnpm dev-android` = release + `--features devtools`.
Related: [[sync-clock-skew-lastsynced-5661]], [[reference-page-count-sync-5716]],
[[resize-anchor-drift-5808]], [[feedback-always-verify-on-xiaomi]].
