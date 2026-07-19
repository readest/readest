---
name: webdav-serverurl-stranded-5141
description: WebDAV serverUrl not synced for configured-but-disabled provider; plaintext seeded-snapshot vs encrypted push-hash asymmetry stranded connection metadata
metadata: 
  node_type: memory
  type: project
  originSessionId: a1862d1a-c5cd-4b21-aed7-62a3290222ba
---

Issue #5141: a WebDAV server configured but NOT enabled synced its
username/password to other devices but NOT the serverUrl — peer got half a
config and couldn't reconnect. Also: on e-ink the enable checkbox ("选择框")
for a configured-but-disabled provider was near-invisible.

Root cause (`src/services/sync/replicaSettingsSync.ts`): plaintext and
encrypted whitelisted settings used two DIFFERENT "was this published?"
trackers, and they diverge:
- Plaintext (`webdav.serverUrl`/`rootPath`) → in-memory `lastPublishedFields`
  map, which `initSettingsSync` SEEDS from disk at boot. Any value already on
  disk is treated as already-published and never sent unless it changes.
- Encrypted (`webdav.username`/`password`) → SHA-256 push-hash in localStorage.
  A value with NO stored hash is treated as never-published and IS sent on the
  next save.

So when WebDAV was configured BEFORE `webdav.*` entered the whitelist
(#4810, [[webdav-credential-sync-4810]]) — or localStorage was cleared — boot
seeding marked serverUrl "already published" (never sent) while the creds had
no hash (sent on next save). Peer received creds but not the URL. Fresh
Connect works fine (serverUrl goes undefined→value while running, so it
diffs). The bug is specifically disk-configured-but-never-published.

Fix: introduced `CONNECTION_PATHS` (derived: whitelisted, not encrypted, but
sharing a top-level group with an encrypted field → webdav.serverUrl/rootPath,
s3.endpoint/region/bucket, kosync.serverUrl, readwise.baseUrl). Track these
with the SAME persisted push-hash as encrypted fields (reuse
get/setStoredEncryptedHash, key prefix `readest_settings_pushed_hash_v1:` is
generic) instead of the disk-seeded snapshot. Three sites: publish loop (new
`else if (CONNECTION_PATHS.has)` branch, skip empty via isMeaningful, store
hash unconditionally since plaintext ships regardless of unlock),
`applyRemoteSettings` (store hash on pull, not lastPublishedFields),
`initSettingsSync` (don't seed connection paths). Empty values stay local
(mirrors encrypted "local-clear stays local"). Structural settings keep the
disk-seeded clobber protection ([[multiwindow-settings-clobber-4580]] class).

Gotcha for tests: the old `initSettingsSync primes snapshot ... does not push`
test used a configured `kosync.serverUrl` fixture to assert no-push — that IS
the buggy behavior. Rewrote it to assert only STRUCTURAL fields
(dictionarySettings/globalReadSettings) stay out of the diff; connection
metadata is hash-tracked and exempt from priming.

E-ink part: DaisyUI unchecked `.checkbox` uses ~20%-opacity border →
invisible on grayscale. Added `[data-eink='true'] input[type='checkbox'].checkbox`
crisp 1px base-content border in globals.css. Scoped to `.checkbox` so
`.toggle` keeps its treatment; `eink-bordered` is WRONG here (its
`background-color:base-100 !important` would wipe the checked fill).

Related: [[webdav-credential-sync-4810]], [[cloud-sync-provider-selection-plan]],
[[multi-provider-cloud-sync-5062]].
