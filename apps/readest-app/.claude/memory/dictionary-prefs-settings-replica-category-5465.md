---
name: dictionary-prefs-settings-replica-category-5465
description: "#5465 dictionary prefs synced despite Dictionaries=off; Manage Sync category != replica kind, and the settings row bundles other categories' fields"
metadata: 
  node_type: memory
  type: project
  originSessionId: 6d5b1b39-cf60-42e5-bc19-5a3c18b5866a
  modified: 2026-08-03T14:48:20.675Z
---

MERGED 2026-08-03 as PR #5470 (squash `1fcaa506b`). Reporter device-verify pending:
older peers keep pushing dict prefs, so only the updated device discards on arrival.

**The trap:** `isSyncCategoryEnabled(kind)` gates by *replica kind*, so a Manage Sync
toggle only covers what its own kind carries. `dictionarySettings.providerOrder /
providerEnabled / webSearches / fontScale` are whitelisted into the **bundled
`settings` row**, so they were gated by "App settings" while the user was flipping
"Dictionaries". The Dictionaries toggle only ever gated the dictionary *bundles*
(binary + metadata). The panel copy even claimed the opposite on both rows.

Fix: `SETTINGS_DICTIONARY_FIELDS` in `services/sync/adapters/settings.ts`;
`publishSettingsIfChanged` skips those paths and `applyRemoteSettings` rebuilds the
incoming patch without them when `isSyncCategoryEnabled('dictionary')` is false.
The `dictionary -> settings` edge in `CATEGORY_DEPENDENTS` stays — they still need
the settings row as transport, it just no longer *implies* they belong to it.

**Why:** any future field added to `SETTINGS_WHITELIST` silently inherits the
"App settings" toggle regardless of which category the user thinks owns it. Same
shape as the `credentials` meta-toggle, which already had to solve this by
cross-cutting the OPDS + settings rows.

**How to apply:** when adding a whitelisted setting that a user would find under a
different Manage Sync row, add it to a category path-set and gate both the push loop
and the pull patch — the adapter whitelist alone is the wrong altitude. Re-enable
does not backfill (the settings cursor advanced past the discarded values); local
values do republish, because the push snapshot was never updated while gated.

Related: [[multi-provider-cloud-sync-5062]], [[sync-fixes]]
