---
name: readest-cloud-signin-optin-6010
description: "#6010 sign-in Readest Cloud opt-in; PR 6045; readestCloud.enabled undefined is load-bearing; cold routes never hydrate the settings store"
metadata: 
  node_type: memory
  type: project
  originSessionId: 7a438c53-a27b-4833-9607-ffe00c9431dc
  modified: 2026-09-03T10:14:12.984Z
---

#6010 "sync options before sync begins". PR #6045 OPEN (branch `fix/sync-optin-before-login`), not verified on device.

**Why sign-in always started a Readest Cloud upload.** `isReadestCloudEnabled = settings?.readestCloud?.enabled ?? !hasAnyThirdPartyEnabled(settings)` (`services/sync/cloudSyncProvider.ts`). A third-party backend needs premium, premium needs an account, so at sign-in there is BY CONSTRUCTION no third-party provider: the fallback derives `true` and `useBooksSync`'s `user` effect fires when `/library` mounts.

**`readestCloud.enabled === undefined` is load-bearing — never pin `true` casually.** Undefined is what makes enabling WebDAV later switch Readest Cloud off; pin it and the library uploads to BOTH. The opt-in decides statelessly at toggle time: `next && !hasAnyThirdPartyEnabled(settings) ? undefined : next`. Needed `persistReadestCloudChoice` because `persistCloudProviderEnabled` takes a plain boolean. Flag is device-local (NOT in `SETTINGS_WHITELIST`), so it never crosses devices; `BACKUP_SETTINGS_DEVICE_LOCAL_FIELDS` excludes only `disabledAt`, so a restore carries `enabled`.

**Cold routes never hydrate the settings store** (found only by running it in Chrome; unit tests seeded the store directly). `/auth` and `/user` load with `settings = {}`, and `isReadestCloudEnabled({})` derives `true`. Pre-existing damage on `/user`: Manage Sync rendered every category from `{}` (all defaults, not the user's values) and flipping a row persisted that empty object over the real settings file. Fix = `hooks/useEnsureSettingsLoaded.ts`; callers hold settings-derived UI back until hydrated. **Check this hook whenever adding settings-derived UI to a directly-reachable route.**

**Reconnect reset Upload Book Files** because two helpers contradicted each other: `buildWebDAVConnectSettings` preserves `syncBooks` across disconnect/reconnect by design, then `withCloudProviderEnabled` force-set `syncBooks: true` on the off->on edge. Now gated on `firstActivation = activating && !slice?.providerSelectedAt`, read BEFORE the write re-stamps it. Disconnect leaves the stamp, so it separates reconnect from first activation.

**Rejected by chrox:** a master Readest Cloud toggle in the Manage Sync header. It only gates `PROVIDER_GATED_CATEGORIES` (`book`/`progress`/`note`); account-level replicas (settings, stats, dictionaries, fonts, textures, opds_catalog, abs_server) have no file-backend counterpart and keep syncing regardless, so half the rows grey out and half don't. chrox: "it still does not make sense why only some options are affected." The underlying naming problem (a switch called Readest Cloud that is really just the library switch) is unresolved and worth its own issue.

Still open: [[kosync-manual-sync-6029]]-style pause work, i.e. #5934 (global pause + per-book do-not-sync), deliberately out of scope here.
