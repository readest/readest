---
name: sync-clock-skew-lastsynced-5661
description: "#5661 tablet shows 'Synced in an hour' — device epoch clock skew poisons client-stamped LWW; Last Synced label shows the OTHER device's clock"
metadata: 
  node_type: memory
  type: project
  originSessionId: 50bf3aa9-4701-4918-b777-79edbd4c2716
  modified: 2026-08-13T08:37:29.826Z
---

Issue #5661: display clamp MERGED #5674 (2026-08-13); `clampSyncTimeForDisplay`
in utils/time.ts wraps the three Last Synced display sites (SyncInfoDialog,
ViewMenu, SettingsMenu). LWW skew itself (progress blocked ~1h) intentionally
NOT fixed — root cause is the user's device clock. Boox Color Go 7 shows phone-created
sync exactly +1h in the future ("Synced in an hour"); tablet progress won't propagate
for ~1h. Tablet-created syncs "look fine on both". Reporter claims both devices UTC+8
with correct wall time.

**Root cause (external, not an app bug per se): the two devices' EPOCH clocks differ
by 1h even though both wall displays look right.** Classic mis-set timezone with a
manually compensated clock (e.g. tz GMT+9 + clock 1h slow, or GMT+7 + 1h fast —
wall display correct either way, Unix epoch off by 1h). Boox = WiFi-only, no carrier
NITZ, prime suspect. Diagnostic for reporters: open https://time.is in a browser on
each device — it compares JS `Date.now()` against their server, so it reports epoch
skew regardless of what the wall clock displays. Also check Settings → Date & time
for the NAMED zone + auto-time/auto-zone toggles.

**Why the app behaves this way (code chain):**
- `book_configs.updated_at` is client-stamped: `saveConfig` stamps `updatedAt: Date.now()`
  (bookDataStore.ts ~163), `transformBookConfigToDB` sends it as ISO.
- Server preserves the client stamp and resolves LWW on it: `clientIsNewer =
  clientUpdatedAt > serverUpdatedAt` (pages/api/sync.ts POST upsertRecords). A
  future-stamped record silently discards every healthy device's pushes until their
  clocks catch up — exactly the "won't update for an hour" symptom.
- On pull, `useSync.pullChanges` sets `lastSyncedAtConfig`/`lastSyncedAtConfigs` to
  `computeMaxTimestamp(records)` = the newest REMOTE record's author-device clock.
  Both display sites show that value: SyncInfoDialog "LAST SYNCED"
  (`formatLocaleDateTime`) and ViewMenu "Synced {{time}}" (`dayjs(...).fromNow()`).
  So "Last Synced" is really "the other device's clock", not when this device synced.
- **Asymmetry explained**: ViewMenu maxes in the device's own `lastPushedAtConfig/Notes`
  (= local `Date.now()`). A foreign stamp 1h in the PAST is masked by the local push
  stamp; a foreign stamp 1h in the FUTURE always wins the max and surfaces. Hence
  the reporter sees it one-way only.
- Side effect: after pulling a future-stamped record the pull cursor sits 1h in the
  future — with a 3rd healthy device its records stamped inside that window would be
  skipped until the -1day slack on restart (useSync init subtracts ONE_DAY_IN_MS).

**Discriminator**: display-only theories (stale WebView ICU tzdata, e.g. Mongolia
+8/+9 DST pre-2017 rules) CANNOT produce this — `fromNow()` and server LWW compare
epochs, so the observed push-blocking proves real epoch skew.

**Candidate app-side hardening (not implemented):**
1. Server clamps client `updated_at`/`deleted_at` to `now() + small tolerance` on
   write — a record can legitimately be authored in the server's past (offline
   edits) but never its future. Bounds cross-device poisoning to the tolerance.
   Careful with books field-clocks (reading_status/cover/metadata_updated_at) and
   the books.progress piggyback `.lt('updated_at')` predicate.
2. Display: "Last Synced" should show device-local sync completion time (or clamp
   to `min(value, Date.now())`), keeping the record-derived value ONLY as the pull
   cursor (cursor must stay record-derived per #4678).
3. Optional: client warns when a pulled stamp exceeds local now + threshold
   ("a device clock appears wrong").
