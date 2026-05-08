# Plan: CRDT-based user-replica sync (server-allowlisted kinds)

## Context

User-imported data and configuration live scattered through `SystemSettings`
and never leave the device:

- `customDictionaries: ImportedDictionary[]` (multi-file bundles under
  `'Dictionaries'/<bundleDir>/`, identity `uniqueId()` — random per device)
- `customFonts: CustomFont[]` (single file under `'Fonts'/`, id `md5(name)`)
- `customTextures: CustomTexture[]` (single file under `'Images'/`, id
  `md5(name)`)
- `opdsCatalogs: OPDSCatalog[]` (URL + credentials, no binaries)
- `dictionarySettings.{providerOrder, providerEnabled, defaultProviderId,
  webSearches}`

`SystemSettings` is written via `safeSaveJSON` and not synced anywhere — the
"syncs to cloud" comment in `customDictionaryStore.ts:81` is misleading. A
user signed in on two devices has to re-import everything on the second
device, and any settings tweak on one device is invisible on the other.

Books already sync along two rails: per-record LWW metadata via the sync-DB
protocol (`src/libs/sync.ts` ↔ `src/pages/api/sync.ts`) and binaries via
`TransferManager` → S3/R2 storage. We want **the same plumbing** for user
replicas, with **CRDT semantics** so concurrent offline edits on two devices
converge automatically when they reconnect.

This plan was reviewed by Codex and substantially revised. Major shifts from
the first draft: kinds are now server-allowlisted (not free-form), the merge
is atomic on the server (not API-level fetch-then-upsert), deletion is
remove-wins (not "edit beats tombstone"), and OPDS credentials are NOT
synced in plaintext.

After Codex revision the plan went through `/plan-ceo-review` (mode: SCOPE
EXPANSION). The user picked Approach A (the cathedral) over per-kind LWW
tables and manual share+import, and accepted **encrypted secrets in v1**
(was deferred to v2 in the Codex-revised draft). The CEO review also
locked a permanent strategic posture: **Readest stays private-only**.
Cross-user content sharing (public/unlisted dictionary library) is not
deferred — it is explicitly out of scope forever. See
`~/.gstack/projects/readest-readest/ceo-plans/2026-05-06-replica-sync-cathedral.md`
for the full decision capture.

## Design tenets

1. **`kind` is from a server-managed allowlist.** The DB has a CHECK
   constraint; the server validates every push against a per-kind schema
   (allowed field names, max JSON size, max field count, filename rules,
   per-user quota). Clients use adapter modules for dispatch ergonomics, but
   adding a new kind is a small **coordinated** client+server change. No
   "drop one file, done."
2. **One polymorphic DB table** holds every allowlisted kind. Kind-agnostic
   columns; per-kind data in a JSONB blob whose shape the server validates.
3. **One CRDT merge function** runs atomically on the server, regardless of
   kind. Field-level LWW with HLC timestamps. Atomic via Postgres RPC or
   `INSERT … ON CONFLICT … DO UPDATE` with a SQL-side merge call.
4. **One transport.** Push/pull, the TransferManager refactor, the cloud
   key scheme, the auth check — all kind-agnostic but kind-validated.
5. **User opts in per-category.** A settings panel lets the user enable or
   disable sync for each category (books, progress, annotations, fonts,
   dictionaries, textures, OPDS catalogs, ...). Disabled categories don't
   push or pull.
6. **Sensitive fields are never synced in plaintext.** A per-account sync
   passphrase (separate from auth password) derives a key via PBKDF2-600k
   (OWASP 2024). Sensitive fields encrypt with AES-GCM before push.
   Encryption lives in each adapter's `pack`/`unpack` (the adapter decides
   which fields are sensitive; HLC stamps the envelope, not plaintext).
   Encryption ships in v1, not v2.
7. **Private-only forever.** Cross-user content sharing (public/unlisted
   replicas, community dictionary library) is explicitly out of scope.
   The polymorphic `replicas` table is internal infrastructure, not a
   future API. Adding any cross-user-visibility feature requires a fresh
   architecture review and is not authorized by this plan.
8. **Scalar settings sync via a bundled row; collections sync per-record.**
   The CRDT model is per-field LWW within a row, so 1 row × N fields and
   N rows × 1 field have identical conflict semantics for scalars.
   Scalar settings (`theme`, `fontSize`, `highlightColor`) and flat maps
   (`providerEnabled`, per-shortcut overrides) collapse cleanly into a
   single `settings` kind with a server-managed field whitelist —
   adding a new synced setting becomes a one-line whitelist addition.
   Collections where each element needs independent identity, tombstones,
   or remove-wins semantics (OPDS catalogs, dictionaries, fonts,
   textures, web searches, ordered provider positions) stay per-record.
   Folding a collection into a bundled row is unsafe under concurrent
   edits: Device A adds X, Device B adds Y, both push the full array,
   last writer wins. Per-record rows preserve both sides via independent
   CRDT envelopes.

## Architecture overview

### Layer 1 — Identity & on-disk storage

- Each replica has an `id: string` stable across devices. Identity = `H(primaryFile partial bytes ‖ byteSize ‖ filename list)` — `partialMD5` alone
  is too collision-prone for adversarial inputs (Codex finding). For
  binary-backed kinds the primary file is the natural anchor (`.mdx` for
  MDict, `.dict.dz` for StarDict, `.slob` for Slob, the font/image bytes
  for fonts/textures). For metadata-only kinds (OPDS catalog, web search,
  provider position/pref), the adapter computes id from natural keys
  (URL+username, web-search uuid, provider id).
- For 1+ GB MDDs we may also schedule a background full streaming hash and
  store it as `strongHash` for tamper detection on re-download. v1 ships
  with `partialMD5` + size + filename mix; full hash is a follow-up.
- Local on-disk paths are per-adapter. Existing `BaseDir`s
  (`'Dictionaries'`, `'Fonts'`, `'Images'`) reused for the current
  kinds.
- Cloud key for binary files: `${userId}/Readest/replicas/<kind>/<id>/<filename>`.
  Filenames are server-validated: no `..`, no `/`, no `\`, length ≤ 255,
  charset restricted.
- A `manifest.json` lists `{filename, byteSize, partialMd5}[]`. The
  upload state machine writes the manifest LAST. A row is only marked
  `downloadable: true` once `manifestUploadedAt` is set. (Codex finding —
  prevents partial-upload races.)

### Layer 2 — CRDT-backed metadata sync

Single Postgres table `replicas`:

```
user_id        uuid           NOT NULL
kind           text           NOT NULL    CHECK (kind IN (... server allowlist ...))
replica_id     text           NOT NULL
fields_jsonb   jsonb          NOT NULL    -- per-field CRDT register; max 64 KiB; max 64 fields
manifest_jsonb jsonb          NULL        -- populated only after binary upload completes
deleted_at_ts  text           NULL        -- HLC string of remove-wins tombstone (never resurrected)
reincarnation  text           NULL        -- new-id token for explicit re-import revival
updated_at_ts  text           NOT NULL    -- max(field ts, deleted_at_ts)
PRIMARY KEY (user_id, kind, replica_id)
INDEX (user_id, kind, updated_at_ts)
RLS: auth.uid() = user_id
CHECK pg_column_size(fields_jsonb) <= 65536
CHECK jsonb_object_keys count <= 64
```

Per-user, per-kind row quotas enforced server-side.

`fields_jsonb` shape (CRDT envelope per field):

```
{
  name:    { v: <any json>, t: '<HLC>', s: '<device id>' },
  enabled: { v: true,        t: '...',  s: '...' },
  ...
}
```

CRDT type: **LWW-Element-Set with per-field LWW-Register and remove-wins
tombstones.**

- **HLC** (Hybrid Logical Clock) — `(physical_ms, logical_counter,
  device_id)`, packed as a sortable string. Clock skew handled by the
  physical component; same-ms ties handled by the counter. **Server clamps
  incoming HLCs**: physical_ms must be within ±60s of server time
  (configurable). Out-of-range writes are rejected with a clock-skew error
  the client can recover from. (Codex finding — prevents far-future HLC
  freezing future writes.)
- **HLC persistence** lives in IndexedDB or the Tauri keyring (a small
  per-account key), not just `localStorage`. Multi-window, storage-clear,
  and reinstall are handled by re-deriving from the remote `max(updated_at_ts)`
  on next pull. (Codex finding.)
- **Per-field LWW-Register** — for each scalar field, keep the entry with
  the largest HLC. Same-field concurrent edits on offline devices: the
  loser's value drops. Documented per-kind (acceptable for `name`,
  `enabled`, `defaultProviderId`; explicitly NOT acceptable for any
  `Map`/`Set`/array — those split into separate rows, see below).
- **Remove-wins tombstones** — `deleted_at_ts` is the record's tombstone
  HLC. **A field write does NOT revive a tombstoned record by HLC alone**
  (the original draft's rule was unsafe — Codex finding). Revival happens
  only via a fresh **reincarnation token**: when an import on Device B
  produces an id that matches a tombstoned row, the importer writes a new
  `reincarnation` value and a fresh row; the tombstone stays put as
  history. The client merges `(deleted=true, reincarnation=null)` rows by
  hiding them; rows with `reincarnation != prior_value` are surfaced as
  alive.

Merge function `mergeReplica(local, remote)` is **deterministic,
commutative, associative, idempotent** — the four CRDT properties — and
lives in `src/libs/crdt.ts`. **The server runs this merge atomically** via
either:

- a Postgres function `crdt_merge_replica(...)` invoked through `INSERT
  … ON CONFLICT (user_id, kind, replica_id) DO UPDATE SET fields_jsonb =
  crdt_merge_replica(replicas.fields_jsonb, EXCLUDED.fields_jsonb), …`,
  OR
- an explicit RPC `rpc_push_replicas(...)` with row locking
  (`SELECT … FOR UPDATE`) in a single transaction.

Either way the merge happens **inside one SQL statement / transaction**, so
two concurrent pushes can't interleave a fetch-then-upsert race. (Codex
finding — the existing `src/pages/api/sync.ts` has separate fetch and
upsert calls; this is an honest protocol upgrade.)

Helpers in `src/libs/crdt.ts`:

- `Hlc.next()` — bumps local counter; persists to IndexedDB.
- `setField(replica, fieldName, value)` — writes `{v, t: Hlc.next(), s}`.
- `removeReplica(replica)` — sets `deleted_at_ts = Hlc.next()`. Permanent.
- `mergeFields(local, remote)` / `mergeReplica(local, remote)` — pure.

### Layer 3 — Sync transport & protocol changes

`src/libs/sync.ts` extension is **not** a one-line change (Codex finding).
`SyncType`, `SyncResult`, and `SyncData` are hard-coded today. The honest
protocol upgrade:

- `SyncType` extends from `'books' | 'configs' | 'notes'` to add `'replicas'`.
- `SyncData` and `SyncResult` add a `replicas: ReplicaRow[]` arm.
- A new RPC route `/api/sync/replicas` (or extend the existing `/api/sync`
  with an `op=replicas` switch) accepts a batch of `(kind, replica_id, fields_jsonb,
  deleted_at_ts, manifest_jsonb)` rows from the client and returns the
  merged authoritative result. The server validates `kind` against the
  allowlist and `fields_jsonb` against the per-kind schema before
  invoking `crdt_merge_replica`.

`src/services/sync/replicaSyncManager.ts`:

- `pull(kind, since?)` — `SELECT … WHERE user_id = $u AND kind = $k AND
  updated_at_ts > $since`. Per-kind cursor (`lastSyncedAtReplicas[kind]`
  in `SystemSettings`).
- `push(rows)` — calls the atomic merge endpoint. Batches up to 100
  rows per request (configurable; benchmark in PR 1).
- `subscribeToLocalMutations()` — listens for `setField` /
  `removeReplica` on the dirty-set; **5-second debounced push**, with
  **immediate flush** on `document.visibilitychange` (tab/app blur)
  and `window.online` events. Industry-standard cadence (Notion,
  Figma).
- HLC counter persists to **IndexedDB always** (high write rate, low
  security). Sync passphrase persists separately:
  - Tauri (native): keychain via `tauri-plugin-keyring` (macOS,
    Windows, Linux libsecret, iOS/Android keystore).
  - Web: ephemeral non-extractable Web Crypto `CryptoKey` held in
    memory; dropped on tab close. Never `localStorage` /
    `IndexedDB` (XSS risk).

### Layer 4 — Generic binary transfer (real refactor)

`TransferManager` and `cloudService` are book-shaped today (Codex finding):

- `TransferItem.bookHash` / `bookTitle` are required (`transferStore.ts:6`).
- `executeTransfer` calls `appService.uploadBook` / `downloadBook` and
  finishes with `updateBook(...)` (`transferManager.ts:202`).
- `uploadFile` (`storage.ts:42`) takes `bookHash`/`fileSize`/`fileName`
  and nothing else.
- `cloudService.uploadFileToCloud` smuggles the cloud path through
  `File.name` (`cloudService.ts:57`).

Honest refactor:

- Generalize `TransferItem` to `{kind: 'book' | 'replica', target: {hash:
  string, title: string, recordKind?: string, recordId?: string}}`. Keep
  the existing book path working unchanged.
- Add a thin `appService.uploadReplica(kind, id, onProgress)` /
  `downloadReplica(kind, id, onProgress)` /
  `deleteReplicaFiles(kind, id)`.
- Add `storage.uploadReplicaFile(kind, recordId, filename, file,
  onProgress)` to the storage wrapper, with explicit cloud-path support
  (no `File.name` smuggling). The book path can migrate later.
- Cloud subdir: a single new constant `CLOUD_REPLICAS_SUBDIR =
  '${DATA_SUBDIR}/replicas'`.

Upload state machine for binary-backed kinds:

1. Adapter writes local files; CRDT row gets created locally with
   `manifest_jsonb = null`.
2. `transferManager.queueReplicaUpload(kind, id)` runs.
3. On each file upload success, the manifest is built incrementally
   (in-memory).
4. **Last step** writes `manifest.json` to the cloud and updates the DB
   row's `manifest_jsonb`. Only then is the row visible to other devices
   as `downloadable`.
5. On partial failure, the row stays `manifest_jsonb = null`; other
   devices see it as "exists in metadata but binaries pending". The
   transfer queue retries; idempotent.

Receivers download with: `manifest_jsonb` defines the file list +
expected sizes/hashes. Mismatches abort.

### Layer 5 — Adapter registry (the open-extension seam, with limits)

`src/services/sync/replicaRegistry.ts` (shape revised after eng review —
core + capability composition, not 9 flat fields):

```
interface ReplicaAdapter<T = unknown> {
  kind: string;                               // must be in the server allowlist
  schemaVersion: number;                      // bumps when the kind's field shape changes
  pack(replica: T): Record<string, unknown>;  // → fields object (encrypts sensitive fields)
  unpack(fields: Record<string, unknown>): T; // ← merged fields → typed replica (decrypts)
  computeId(input: ...): Promise<string>;
  binary?: BinaryCapability<T>;               // present only for binary-backed kinds
  lifecycle?: LifecycleHooks<T>;              // optional load/save hooks
}

interface BinaryCapability<T> {
  localBaseDir: BaseDir;
  enumerateFiles(replica: T): { logical: string; localRelPath: string; byteSize: number }[];
}

interface LifecycleHooks<T> {
  postDownload?(replica: T, fs: FileSystem): Promise<void>;
  validateOnLoad?(replica: T, fs: FileSystem): Promise<{ unavailable?: boolean }>;
}

const registry = new Map<string, ReplicaAdapter>();
export function registerReplicaAdapter(adapter: ReplicaAdapter): void;
  // throws on duplicate kind registration (defensive — guards against
  // doubly-imported adapter modules during dev hot-reload)
export function getReplicaAdapter(kind: string): ReplicaAdapter | undefined;
```

Self-registering adapters are a client-side dispatch convenience — the
server is the source of truth for what kinds are valid. Clients tolerate
unknown kinds in pull responses (skip + log) rather than crashing, since
older clients may receive newer kinds during a phased rollout.

The server-side allowlist + per-kind JSON schema lives in code:
`packages/server-schema/replicaSchemas.ts` (or similar) — TypeScript
schemas validated at runtime via Zod or equivalent. Adding a kind = client
adapter PR + server schema PR + DB migration if `CHECK (kind IN …)`
changes (we use a `kinds_allowlist` reference table to avoid migrations
on every add).

## Per-kind initial allowlist (ship in this order)

| kind | binary | id source | files / shape |
|---|---|---|---|
| `dictionary` | yes | `partialMD5(primaryFile) + size + filenames` | mdx + mdd[] + css[] (skip `.idx.offsets`/`.syn.offsets`) |
| `font` | yes | `partialMD5(file) + size + filename` | single .ttf/.otf/.woff[2] |
| `texture` | yes | `partialMD5(file) + size + filename` | single image |
| `opds_catalog` | no | `md5("opds:" + url.lower())` | — (URL + name + headers + **password ENCRYPTED**) |
| `settings` | no | `'singleton'` (one row per user) | — (whitelisted scalar fields + flat maps via namespaced field keys; covers `theme`, `fontSize`, `highlightColor`, `lineHeight`, `pref:*`, `shortcut:*`, `providerEnabled.<id>`, `syncCategories.<id>`, etc.) |
| `dict_provider_position` | no | provider id | — (one position string + actor id; per-element rows because concurrent rename + reorder must preserve both sides) |
| `dict_web_search` | no | existing `WebSearchEntry.id` | — (collection of independent records — needs per-record tombstones) |

`settings` replaces what would otherwise be N per-kind adapters for each
scalar setting. Adding a new synced setting = one-line whitelist + a
server schema bump; no new adapter, no new client wiring.

Future kinds require a server PR (schema + allowlist + migration if
needed).

## User-selectable sync categories

A new settings panel under **Account → Sync** with per-category toggles.
Default: book/config/note/dictionary/font/texture/opds_catalog/settings
all ON; internal kinds (`dict_provider_position`, `dict_web_search`)
follow the parent (dictionary) toggle. `providerEnabled.<id>` lives
inside the `settings` bundle and rides the `settings` toggle, not the
`dictionary` toggle (small ergonomic gap; surfaced in the Sync panel
copy).

`SystemSettings.syncCategories: Record<string, boolean>` stores the
preferences. Per tenet 8, the category map itself becomes a flat map
inside the `settings` bundle (`syncCategories.<kind>` namespaced fields)
once the bundle ships in PR 5 — no separate `sync_pref` kind needed.
Per-category gates apply at the sync manager:

- `pull(kind)` no-ops if `syncCategories[kind] === false`.
- `push(rows)` filters out rows whose kind is disabled.
- Disabling a category doesn't delete remote rows — it just stops the
  device from sending or receiving them. Re-enabling resumes from the
  current `updated_at_ts` cursor.

UI surfaces existing book/config/note sync toggles too (today they're
implicitly always-on). Per-device override is a v2 concern; v1 is
per-account.

## Encrypted secrets sync (v1 — per CEO review)

Sensitive fields across any kind sync encrypted from day 1. Initial
sensitive field: `opds_catalog.password` (and `username` if the user
prefers). Future kinds' secrets (AI API keys, etc.) reuse the same
machinery.

### Sync passphrase

- User sets a **sync passphrase** (separate from Readest auth password)
  via Settings → Sync → "Set sync passphrase" inline modal.
- **Lazy first prompt:** the passphrase modal first appears when the
  user attempts to push or pull an encrypted-field replica (e.g., first
  OPDS import with credentials, or first sign-in on Device B that pulls
  an encrypted row). Users who never use sensitive features never see
  the prompt.
- Passphrase storage on device:
  - **Tauri (desktop + mobile):** native keychain via Tauri keyring
    plugin (macOS Keychain, Windows Credential Manager, iOS Keychain,
    Android Keystore). Survives app restart.
  - **Web:** prompt **per session**. Hold passphrase-derived key as a
    non-extractable Web Crypto `CryptoKey`; drop on tab close. Never
    persist to `localStorage` or `IndexedDB` (XSS exposure).
- Per-account salt: server stores a per-user `salt_v1: bytea` (random,
  immutable) in a `replica_keys(user_id, salt, alg, created_at)` table.
  Salt itself is useless without the passphrase. Salt rotation is a v2
  concern.

### Key derivation & encryption

```
key = PBKDF2(
  passphrase,
  salt = server.replica_keys.salt_v1,
  iterations = 600_000,           // OWASP 2024 for SHA-256 PBKDF2
  hash = 'SHA-256',
  length = 256
)

ciphertext, iv, tag = AES-GCM(plaintext, key, randomIV)
hashSidecar = SHA-256(plaintext)
```

### Encrypted-field envelope

Stored in `fields_jsonb` alongside plain fields. The adapter's `pack`
decides which fields encrypt:

```
{
  url:      { v: '...',                                  t: '<HLC>', s: '<dev>' },  // plaintext
  username: { v: 'alice',                                t: '...',  s: '...' },     // plaintext
  password: {
    v: { c: '<b64-ciphertext>',
         i: '<b64-iv>',
         s: 'salt_v1',
         alg: 'aes-gcm/pbkdf2-600k-sha256',
         h: '<b64-sha256-of-plaintext>' },
    t: '<HLC>', s: '<dev>'
  }
}
```

- **`alg`** lets us bump iterations or change cipher later (alg
  registry: `aes-gcm/pbkdf2-600k-sha256` initially).
- **`h`** is the SHA-256 sidecar — client verifies hash after decrypt
  to detect post-merge corruption without revealing plaintext to the
  server.
- HLC stamps the **envelope**, not the plaintext. The CRDT merge sees
  opaque ciphertext. Per-field LWW works on encrypted fields exactly
  the same as plaintext fields.

### Encryption sits inside the adapter

`pack(replica)` and `unpack(fields)` per adapter own the
encrypt/decrypt boundary. The OPDS adapter calls `encryptField()` for
`password`; the dictionary adapter encrypts nothing. The sync manager,
CRDT merge, and Postgres function are encryption-agnostic. This keeps
the threat model per-adapter.

### Passphrase rotation

Changing the passphrase re-encrypts every encrypted field locally (with
the new key) and pushes the new envelopes — but does **not** bump HLC
on those fields (no semantic mutation, just envelope swap). Server runs
the merge as usual; receiving devices re-decrypt.

If the user changes passphrase on Device A and Device B comes online
later, B's old passphrase fails to decrypt → B is prompted "passphrase
changed on another device — re-enter."

### Forgot passphrase

A "Forgot passphrase" CTA in Settings → Sync triggers a confirmation
dialog ("This will permanently delete your synced encrypted fields. You
can re-enter them on each device. Continue?"). On confirm:

1. Server deletes (or NULLs) every `fields_jsonb` envelope where
   `alg LIKE 'aes-gcm/%'` for that user.
2. New per-user salt is generated server-side (`replica_keys.salt_v2`).
3. User re-enters affected secrets per device.

Plain-text fields untouched. Recoverable.

### Wrong-passphrase handling

Decryption failure (auth tag fail or SHA256 sidecar mismatch) raises
`DecryptError` / `IntegrityError`. The replicaSyncManager catches and:

- Surfaces a one-time toast: "Sync passphrase incorrect" or "A synced
  field couldn't be verified. Reverting to local copy."
- Refuses to overwrite local cache with the failed remote value.
- Logs replica id + field name for diagnostics. **Local plaintext copy
  is preserved** so the user is never locked out of their own data.

## Stores

Each store's mutations route through CRDT helpers
(`replicaSyncManager.setField(kind, id, field, value)` /
`removeReplica(kind, id)`) instead of writing `SystemSettings` directly.
On load:

1. Hydrate from `SystemSettings` (the local cache).
2. If `syncCategories[kind] !== false`, run
   `replicaSyncManager.pull(kind, sinceCursor)`.
3. Apply merged fields back to the cache via the adapter's `unpack`.
4. Run `validateOnLoad` per record (sets `unavailable` if local files
   missing).

Store CRUD methods bump `updatedAt_ts` and enqueue a push. Removals call
`removeReplica` (HLC tombstone). Re-imports use the **explicit
reincarnation path**: importer computes new id, checks the local cache —
if a tombstoned row exists with the same id-input but no
`reincarnation`, write a new `reincarnation` token (random) and
re-create the local record under the new logical entity. This avoids the
"stale offline edit revives a tombstone" foot-gun.

## Phasing (revised)

Codex flagged the original phasing as wrong: "PR 1 creates a broad
generic platform before proving one kind." Revised sequence:

### PR 1 — dictionary-only sync, fixed schema (with encryption infra)

- `replicas` table + RLS migration with **only `'dictionary'` in the
  CHECK constraint allowlist** initially.
- `replica_keys(user_id, salt, alg, created_at)` table for per-user
  PBKDF2 salt (encryption infra ships in PR 1 even though dictionary
  has no encrypted fields — having the infra ready avoids a data
  migration when encrypted-field kinds arrive).
- `crdt.ts` (HLC + merges + tests).
- `crypto.ts` (PBKDF2-600k key derivation, AES-GCM encrypt/decrypt,
  envelope helpers, SHA-256 sidecar verification, passphrase storage
  abstraction with Tauri keychain + web per-session backends).
- Atomic merge via Postgres function `crdt_merge_replica` with
  `SECURITY DEFINER` and explicit `auth.uid() = user_id` guard inside
  the function body (RLS alone is insufficient for SECURITY DEFINER).
- A new `/api/sync/replicas` endpoint (kind=dictionary only). Server
  enforces `kind` allowlist, JSON size cap (64 KiB / row), field count
  cap (64 / row), filename validation, per-user-per-kind row quota,
  `schemaVersion` bounds (`minSupported ≤ x ≤ maxKnown`), and HLC
  ±60s skew clamp.
- Replicas reuse the **existing book signed-URL upload pattern** for
  binary uploads (bypasses CF Workers body limit; supports 1+ GB).
- `dictionaryAdapter.ts` registered.
- `customDictionaryStore` rewires through the new manager.
- Migration: rehash legacy `bundleDir` ids in a staged path with backup
  (write new metadata alongside old, validate, then swap; preserve
  `providerOrder` mapping).
- TransferManager refactor for `kind: 'replica'` (book path unchanged).
- Settings → Sync panel with the dictionaries toggle (and the
  pre-existing book/config/note toggles surfaced).
- UI: `<CloudReplicaRow>` in `CustomDictionaries.tsx` for "Download from
  cloud (X MB)".
- Feature flag `ENABLE_REPLICA_SYNC` (default off in production for the
  first 2 weeks; on for staging and dev).
- README at `src/libs/crdt.ts` with HLC + merge worked examples
  (knowledge concentration mitigation).

This PR proves the entire stack against one real kind, with the
encryption infrastructure ready for PR 4 (OPDS catalogs). After it
ships and stabilizes, decide whether to extract generic primitives
(Codex's recommendation: extract only after the second kind validates
the abstraction).

### PR 2 — extract primitives + add `font`

Refactor any dictionary-specific bits in `replicaSyncManager` /
`TransferManager` to be kind-agnostic now that we have a real second
example. Add `'font'` to the allowlist + schema + adapter.

### PR 3 — `texture`

Similar shape to fonts.

### PR 4 — `opds_catalog` (split into 4a + 4b + 4c + 4d)

Originally one PR; split during build because the crypto introduction
is a step-up in complexity that benefits from separate review surfaces,
and the Tauri keychain backend is cross-language work (Rust + Swift +
Kotlin) that's easier to review on its own.

**PR 4a — encrypted-field session wiring (no consumer kind).** Ships
the per-account PBKDF2 salt endpoint (`/api/sync/replica-keys` + the
`replica_keys_create` / `replica_keys_list` RPCs against the
`replica_keys` table from migration 003), the in-memory `CryptoSession`
manager that derives keys lazily per `saltId`, and tests. No UI, no
consumer kind. Production-ready infrastructure for PR 4c.

**PR 4b — `opds_catalog` plaintext fields.** Adapter syncs `id`,
`name`, `url`, `description`, `icon`, `customHeaders`, `autoDownload`,
`disabled`, `addedAt`. Stable cross-device id from `md5("opds:" +
url.lower())`. Credentials (`username`, `password`) stay local-only —
not pushed, not pull-overwritten. Public catalogs sync end-to-end
immediately; credentialed catalogs need re-entry on each device until
4c lands.

**PR 4c — `opds_catalog` encrypted credentials + passphrase UX (TS-only).**
Adds `username` and `password` as encrypted-field envelopes via the
crypto session shipped in 4a. Ships the lazy `getOrPromptPassphrase`
helper, a passphrase prompt modal that fires on first encrypted-field
push or pull, a Sync section in Settings with "Set sync passphrase" /
"Change passphrase" / "Forgot passphrase" actions, the
forgot-passphrase server endpoint (wipes encrypted envelopes + rotates
salt), and the adapter contract change to support async pack/unpack
for encryption. Web users get the per-session ephemeral passphrase
storage; **native users also use ephemeral storage in this PR** and
re-enter their passphrase each app launch — a known UX wart that PR 4d
fixes by wiring the Tauri keychain.

**PR 4d — Tauri keychain backend (Rust + iOS + Android).** Replaces
`EphemeralPassphraseStore` on native with persistent OS-keychain
storage via the existing `tauri-plugin-native-bridge` plugin. Desktop
uses the `keyring` Rust crate (macOS Keychain, Windows Credential
Manager, Linux libsecret); iOS uses the Security framework via Swift;
Android uses the AndroidKeystore via Kotlin. No TS surface change —
`TauriPassphraseStore` becomes the platform default; web continues to
use `EphemeralPassphraseStore`. Eliminates the per-launch re-prompt on
native.

### PR 5 — `settings` bundled kind (collapses original PR 5 + PR 6+)

Per tenet 8, one `settings` adapter with a server-managed whitelist of
`SystemSettings` keys, instead of N per-kind adapters for each scalar
setting. Initial whitelist: `theme`, `fontSize`, `lineHeight`,
`highlightColor`, `pref:*`, `shortcut:*`,
`dictionarySettings.providerEnabled` (encoded as namespaced field keys
like `providerEnabled.<id>`), `syncCategories.<id>`.

Singleton row (`replica_id = 'singleton'`) per user. Per-field LWW
handles concurrent edits across devices: Device A toggles dark mode,
Device B changes font size, both push, both apply. Adding a new synced
setting is a one-line whitelist addition + a server schema bump — no
new adapter, no new client wiring.

This collapses what was previously planned as PRs 5 + 6+ (per-kind
adapters for `dict_provider_pref`, `pref`, `theme`, `shortcut`,
`annotation_rule`, etc.). The genuinely-different shapes (ordered
collections, independent-record collections) ship as PR 6 and PR 7.

### PR 6 — `dict_provider_position` (ordered list with per-position rows)

The provider order is the only setting that genuinely needs per-element
rows: concurrent rename + reorder must preserve both sides, which a
single-field array can't do. Per-position rows keyed by
`(position, actorId, replicaId)` with deterministic tiebreak.
Migrates `dictionarySettings.providerOrder` off the single-array
shape.

### PR 7 — `dict_web_search` (custom web-search entries)

Collection of independent records — each with `id`, `name`,
`urlTemplate`, plus tombstones. Per-record rows because users add /
delete / rename entries independently across devices.

### PR 8+ — incremental whitelist additions

New scalar settings join the `settings` whitelist as needed (one-line
PR + server schema bump). Future encrypted-field needs (AI API keys,
etc.) get either:

- A new dedicated kind (if it needs its own quota, allowlist, or
  per-record tombstones), OR
- A namespaced encrypted field within `settings` (if it's a small
  scalar that fits the bundled pattern — e.g.,
  `aiApiKey.openai`, `aiApiKey.anthropic`).

## Migration

For dictionaries (PR 1):

1. On first launch after upgrade, for each entry without a content-hash
   id:
   - Identify primary file by kind.
   - Compute `id = partialMD5(primary) + size + filenames`.
   - Write a NEW row alongside the old (don't delete the legacy
     `bundleDir` until validated).
   - Move `providerOrder` / `providerEnabled` / `defaultProviderId`
     references from old id → new id.
   - Validate: re-load and look up a known word — if it works, soft-
     remove the legacy entry (move bundleDir to `.legacy/<old-id>/`,
     keep for one release cycle as backup).
2. If bundle missing on disk and `id` is absent — surface "needs
   re-import to enable cloud sync" and skip until re-import.
3. Idempotent: a second pass sees `id` already populated and skips.

For other kinds: similar staged backup pattern in their respective
PRs.

## Edge cases

- **Concurrent rename + reorder** on offline devices: only post-PR-5
  (when `providerOrder` is split). Pre-PR-5: the array-shaped order
  field is per-replica LWW; the loser's reorder drops. Document.
- **Concurrent rename**: HLC tiebreak. Loser's name drops. Acceptable.
- **Same dict imported on two devices**: same content → same id. Both
  push idempotently; binary uploads overwrite same key with identical
  bytes. Manifest writes are last-wins identical.
- **Re-import producing different bytes** (user upgraded the dict file):
  new id. Old row tombstoned; new row inserts. Manifest of old row stays
  pointing at old binaries until cleanup (run a daily server-side
  reaper for tombstoned rows older than N days; delete cloud files).
- **Tombstone resurrection**: requires explicit `reincarnation` token.
  Stale offline edits do NOT revive deleted records.
- **Mixed-version clients**: old clients ignore unknown kinds. New
  clients tolerate unknown kinds in pull. Schema bumps via
  `schemaVersion` on the adapter; server validates
  `minSupported ≤ schemaVersion ≤ maxKnown` (both bounds, per CEO
  review — prevents a malicious client claiming arbitrary version).
- **Bundle 1+ GB**: reuses the existing book signed-URL path (bypasses
  CF Workers body limit). Future: streaming + resumable uploads as
  separate work.
- **Quota exhaustion mid-upload**: existing TransferManager toast/retry
  copy applies. Server-side per-user-per-kind row count limit returns
  402 / 507 on push.
- **Free-form filenames**: server validates (no `..`, no path
  separators, length cap, charset). Cloud key escape lives there.
- **Far-future HLC**: server clamps; client repairs by re-deriving from
  remote `max(updated_at_ts)`.
- **HLC persistence failure** (IndexedDB / Tauri keychain unavailable):
  fall back to `serverMax + 1` per push; accept potential same-ms
  collisions; document.
- **Manifest commit failure** (binary uploads succeed but
  `manifest_jsonb` write fails): TransferManager retries 3x with
  backoff. After max retries, surface "Replica X stuck syncing — retry
  from Settings" toast with action button; row stays
  `manifest_jsonb = null` until success.
- **SHA-256 sidecar mismatch on encrypted field** (corruption or
  tamper): refuse remote, surface one-time toast "A synced field
  couldn't be verified. Reverting to local copy.", log replica id +
  field. Local plaintext preserved.
- **Wrong sync passphrase** on Device B: decrypt throws `DecryptError`
  cleanly, no corrupt result. UI prompts re-entry.
- **Sync passphrase changed on another device**: this device's old
  passphrase fails; UI prompts "passphrase changed on another device —
  re-enter."
- **Forgot sync passphrase**: confirm-dialog → server wipes encrypted
  envelopes (`fields_jsonb` rows where any field has `alg LIKE
  'aes-gcm/%'`); per-user salt rotated; user re-enters affected
  secrets per device. Plaintext fields untouched.

## Error & rescue map (consolidated)

| Exception class            | Rescued | Action                                      | User sees                          |
|---|---|---|---|
| `TimeoutError`             | yes     | retry 2x backoff                            | (transparent)                      |
| `AuthError` (401)          | yes     | refresh token; re-auth flow                 | "Sign in again"                    |
| `QuotaExceededError` (402/507) | yes | halt push; toast                            | "Storage full — manage in Settings"|
| `ClockSkewError` (409)     | yes     | re-derive HLC from server max; retry once   | (transparent)                      |
| `ValidationError` (422)    | yes     | halt push; log payload loudly               | (transparent — devs see logs)      |
| `ServerError` (5xx)        | yes     | retry 3x backoff                            | "Sync paused — retrying"           |
| `DecryptError`             | yes     | prompt for passphrase                       | "Sync passphrase incorrect"        |
| `IntegrityError`           | yes     | refuse remote; toast; preserve local        | "A synced field couldn't be verified" |
| `UnsupportedAlgError`      | yes     | skip + log + suggest update                 | "Update Readest to read this data" |
| `SaltNotFoundError`        | yes     | re-fetch salt list from server              | (transparent)                      |
| `CryptoUnavailableError`   | yes     | disable encrypted-field sync                | "Browser doesn't support encryption" |
| `NoPassphraseError`        | yes     | prompt for passphrase                       | "Set sync passphrase"              |
| `LocalFileMissingError`    | yes     | mark replica unavailable; log               | "Replica X needs re-import"        |
| `TransferError`            | yes     | retry per existing pattern                  | (existing UI)                      |
| `StorageError`             | yes     | retry with backoff                          | "Sync paused"                      |
| `ManifestCommitError`      | yes     | retry 3x; then surface "stuck" toast        | "Dictionary X stuck syncing — retry" |
| `UnknownKindError`         | yes     | skip + log                                  | (transparent)                      |
| `SchemaTooNewError`        | yes     | skip + log + offer update                   | "Update Readest"                   |
| `LegacyMigrationSkipError` | yes     | skip; surface "needs re-import"             | "Re-import to enable cloud sync"   |
| `HlcPersistError`          | yes     | fall back to `serverMax + 1`                | (transparent)                      |

## Observability

PR 1 ships with the full metric set from day 1:

**Metrics:**
- `replicas_pushed_total{kind, outcome}` — counter (success / error /
  rejected_quota / rejected_skew / rejected_validation)
- `replicas_pulled_total{kind}` — counter
- `crdt_merge_duration_seconds{kind}` — histogram (Postgres function
  side; emit via pg_stat or RPC return)
- `encryption_failures_total{reason}` — counter (decrypt_error,
  integrity_error, no_passphrase, unsupported_alg)
- `manifest_commit_failures_total{kind}` — counter
- `hlc_skew_rejections_total` — counter
- `replica_quota_rejections_total{user_id}` — counter (sampled)

**Structured logs:** entry/exit per merge, per-error at warn/error
with `replica_id`, `kind`, `field` (no plaintext values), `user_id`
hash.

**Day-1 alerts:**
- `encryption_failures_total` rate spike > 5x baseline (1h window) →
  page (suggests passphrase or salt issue, or attack)
- `hlc_skew_rejections_total` rate spike > 10x baseline → page
  (suggests bad client or NTP drift across users)
- `manifest_commit_failures_total` rate spike → page (suggests R2
  outage)

## Deployment & rollout

- **Feature flag** `ENABLE_REPLICA_SYNC` (server-side per-user, default
  off in production for the first 2 weeks; on for staging and dev).
  Rollout: dev → 5% prod → 25% → 50% → 100% over ~3 weeks.
- **Migrations** are additive (new tables, new function, new RLS
  policies). Zero-downtime, no table locks.
- **Backwards compat:** old clients (no replica-sync awareness) keep
  working; `/api/sync/replicas` 404 to them is fine. New clients
  (replica-sync aware) seeing 404 disable replica sync, log, continue
  to use existing book/config/note sync.
- **Smoke test post-deploy:** push+pull a synthetic replica end-to-end
  per environment. Verify echo, manifest commit, decrypt round-trip
  (in the encryption follow-up PR).
- **Rollback posture:** feature flag off cuts client traffic instantly.
  Server data persists harmlessly. Schema migrations are forward-only
  (CRDT/HLC/encryption can't easily un-merge); document this as
  Reversibility = 3/5.

## Critical files

New:

- `src/libs/crdt.ts` — HLC + merge + tests + README. HLC string format:
  `${physicalMs.toString(16).padStart(13, '0')}-${counter.toString(16).padStart(8, '0')}-${deviceId}`.
  Lexicographic order matches temporal order (invariant test).
- `src/libs/crypto/derive.ts` — PBKDF2-600k (OWASP 2024) key derivation.
- `src/libs/crypto/encrypt.ts` — AES-GCM encrypt/decrypt round-trip.
- `src/libs/crypto/passphrase.ts` — passphrase storage abstraction:
  Tauri keychain backend + web per-session ephemeral backend. Set,
  change, forget operations.
- `src/libs/crypto/envelope.ts` — envelope shape `{c, i, s, alg, h}`,
  encode/decode helpers, SHA-256 sidecar verification.
- `src/libs/errors.ts` — `class SyncError extends Error { code:
  SyncErrorCode }` with a `SyncErrorCode` union covering all 19 paths
  in the error map. Single `instanceof` check; switch on `.code` for
  handling. (Replaces the 19-class hierarchy in the prior plan.)
- `src/services/sync/replicaRegistry.ts` — adapter map.
- `src/services/sync/replicaSyncManager.ts` — pull/push/merge orchestration.
- `src/services/sync/adapters/dictionary.ts` (PR 1), then
  `font.ts`, `texture.ts`, `opdsCatalog.ts`,
  `dictProviderPref.ts`, `dictProviderPosition.ts`,
  `dictWebSearch.ts` (later PRs).
- `src/services/sync/adapters/index.ts` — barrel.
- `src/components/settings/CloudReplicaRow.tsx` — shared cloud-state row.
- `src/components/settings/SyncCategoriesPanel.tsx` — per-category toggles.
- DB migrations: `replicas` table + `replica_keys` table +
  `crdt_merge_replica()` Postgres function (with `SECURITY DEFINER` and
  explicit `auth.uid() = user_id` guard).
- Server-side schema definitions: `src/server/replicaSchemas.ts` (Zod
  schemas; allowlist; per-kind quotas; filename validators;
  `schemaVersion` bounds).
- `src/components/settings/SyncPassphrasePanel.tsx` — set/change/forgot
  passphrase UX; lazy-prompted on first encrypted-field operation.

Modified:

- `src/types/replica.ts` (new) — `ReplicaRow`, `SyncableReplica` base.
- `src/libs/sync.ts` — add `'replicas'` to `SyncType`, extend
  `SyncResult`/`SyncData`.
- `src/pages/api/sync.ts` — wire to `crdt_merge_replica` Postgres
  function via `INSERT … ON CONFLICT … DO UPDATE` or RPC.
- `src/services/transferManager.ts` — `kind: 'book' | 'replica'`
  discriminator; new `queueReplica*` methods.
- `src/store/transferStore.ts` — `kind` on `TransferItem`; book fields
  optional.
- `src/services/cloudService.ts` — explicit `cfp` argument support
  (drop `File.name` smuggling).
- `src/libs/storage.ts` — `uploadReplicaFile` API alongside `uploadFile`.
- `src/services/appService.ts` — `uploadReplica` / `downloadReplica` /
  `deleteReplicaFiles`.
- `src/types/system.ts` — declare new methods.
- `src/services/constants.ts` — `CLOUD_REPLICAS_SUBDIR`.
- `src/services/dictionaries/dictionaryService.ts` — id from new hash
  recipe (partial + size + filenames).
- `src/store/customDictionaryStore.ts` — replica-sync integration,
  staged migration, reincarnation revival.
- `src/types/settings.ts` — add `syncCategories` field.
- `src/components/settings/CustomDictionaries.tsx` — `<CloudReplicaRow>`.

## Verification

Manual end-to-end:

1. Sign in on Devices A and B. Take both offline.
2. On A: rename dict X. On B: disable X. Reconnect → both survive (per-
   field LWW).
3. On A: rename dict X to "Foo". On B: rename dict X to "Bar".
   Reconnect → HLC tiebreak picks one; loser's rename gone (acceptable;
   document).
4. On A: delete dict X. On B: re-import same content. Reconnect → A
   sees the re-imported entry (reincarnation token; new logical record).
5. Disable "fonts" sync in Settings → Sync. Verify no font records pull
   or push from that device. Re-enable → resumes.
6. Lazy-download large dict on a fresh device → manifest verifies file
   list + sizes; partial download retries cleanly.
7. OPDS catalog with credentials imported on A → appears on B; B
   prompts to set sync passphrase if not set, then auto-decrypts the
   password.
8. Far-future HLC injected by a synthetic client → server rejects with
   clock-skew error; client repairs.
9. Set sync passphrase on A → push encrypted OPDS catalog → sign in on
   B → enter passphrase → password decrypts and OPDS catalog works.
10. Forgot-passphrase flow on A → server wipes encrypted envelopes →
    salt rotates → A re-enters credentials → B sees old envelopes
    gone, prompts re-enter on its side.
11. Wrong passphrase on B → `DecryptError` toast; local plaintext copy
    preserved; user not locked out.
12. Tamper test: corrupt one byte of an encrypted envelope's `c` →
    `IntegrityError` toast; remote refused; local preserved.

Automated:

- `crdt.ts` unit tests: HLC monotonicity; field-level LWW commutativity,
  associativity, idempotence; remove-wins tombstone rules; reincarnation
  token logic.
- `crypto.ts` unit tests:
  - encrypt → decrypt round-trip = identity.
  - SHA-256 sidecar verification catches tampered ciphertext.
  - Wrong passphrase raises `DecryptError`, not corrupt result.
  - PBKDF2 600k key matches reference vector.
  - Cross-platform key-derivation parity (Tauri keychain vs web Crypto
    subtle): same passphrase + salt → same key bytes.
  - Forgot-passphrase wipe: encrypted envelopes nulled; plaintext
    fields preserved.
- Server merge test: two concurrent pushes against the same replica with
  different field updates both land (no lost field).
- Adapter contract test: every adapter satisfies `pack ∘ unpack =
  identity`; `kind` is in the allowlist; `computeId` is deterministic.
- Schema validation tests: invalid filenames rejected, oversize JSON
  rejected, unknown kind rejected, `schemaVersion` out of bounds
  rejected.
- Migration test: legacy `uniqueId()` dict → new content-hash id;
  `providerOrder` references rewritten; idempotent rerun.
- E2E sync category toggle test: disable/enable per kind.
- Manifest atomicity test: kill upload mid-flight, verify
  `manifest_jsonb = null` on the row, verify recovery on next launch
  retries cleanly.
- 1+ GB upload regression: replica path must use the same signed-URL
  pattern books use; assert request body never goes through a Worker.
- RLS test: `crdt_merge_replica()` with `SECURITY DEFINER` correctly
  rejects writes where `auth.uid() != user_id` even when caller has
  service role.
- **Push trigger:** debounce of 5s plus immediate flush on
  `visibilitychange` and `online` events behaves correctly under rapid
  successive mutations.
- **HLC packing format invariant:** for any pair of HLCs `a`, `b` with
  `a.physicalMs < b.physicalMs`, lexicographic comparison of packed
  strings preserves the order; same for counter ties.
- **Postgres `crdt_merge_replica()` preserves unknown fields:** when
  the incoming row carries a field not present locally (or vice versa),
  the merged row keeps both. Forwards-compat with future schemaVersion
  bumps.
- **`replicaRegistry` double-registration:** calling
  `registerReplicaAdapter(adapter)` twice with the same `kind` throws
  (defensive guard against doubly-imported modules during dev
  hot-reload).
- **Error code → UX mapping:** every `SyncError.code` maps to the
  expected user-visible behavior (toast, log only, prompt, retry, etc.)
  per the error/rescue map. Drives the integration test for each row of
  the table.
- **TransferManager regression:** existing book upload path
  (`type: 'upload', kind: 'book'`) behaves identically before and after
  the `kind` discriminator is added. No regression in book sync.
- **`assertNever` exhaustiveness:** every `switch` over `SyncType`
  ends in `default: assertNever(_)` so a future fifth value is caught
  at compile time.
- **Per-kind quota enforcement:** push 1 row beyond the per-user-per-
  kind limit returns 402/507; in-flight rows already accepted are not
  rolled back.
- **Concurrent same-field tiebreak:** Device A writes
  `name='Foo' @t1`, Device B writes `name='Bar' @t2 (t2 > t1)`; both
  push; both pull; both converge to 'Bar' (HLC tiebreak).

## Manifest schema (locked)

```
type Manifest = {
  files: {
    filename: string;     // server-validated: no `..`, no `/`, no `\`,
                          //   length ≤ 255, charset restricted
    byteSize: number;
    partialMd5: string;   // 32-hex; matches client-side computation
    mtime?: number;       // optional; clock-skew tolerant; never trusted
                          //   for ordering, only display
  }[];
  schemaVersion: number;  // future-proof for manifest format changes
};
```

`manifest_jsonb` in the `replicas` row stores this exact shape.

## Performance baselines (PR 1 SLOs)

- Push p95 latency < 500ms for batches ≤ 50 rows on broadband.
- Pull p95 latency < 1s for ≤ 1000 rows.
- `crdt_merge_replica()` p99 < 50ms per row at the 100-row batch cap.
- 1+ GB MDict upload sustained throughput ≥ 80% of network capacity
  (signed-URL direct-to-R2 path, no Worker proxy).
- PBKDF2-600k derivation < 2s on iPhone SE-class hardware. Web Worker
  offload deferred to v2 if real-device telemetry shows jank.

## Open decisions

1. **Atomic merge mechanism** — **DECIDED:** inline UPSERT via
   `INSERT … ON CONFLICT … DO UPDATE SET fields_jsonb = crdt_merge_replica(...)`.
   One round-trip, less code than explicit RPC.
2. **Per-device sync override**: per-account toggles only (this plan)
   vs also per-device override. Recommend per-account in v1; revisit if
   users ask for laptop-only sync.
3. **Strong hash**: skip `strongHash` (this plan) vs background full
   streaming hash for tamper detection. Recommend skip in v1.
4. **External CRDT library** — **DECIDED:** roll-our-own. Yjs and Loro
   impose JSON-incompatible wire formats; field-level LWW is the only
   primitive we need.
5. **OPDS encryption phase** — **DECIDED (CEO review):** ship encrypted
   sync in **v1**, not v2. Crypto infra (`crypto.ts`,
   `replica_keys` table, sync passphrase UX) ships in PR 1; the OPDS
   adapter that uses it ships in PR 4.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | issues_found | Mode SCOPE EXPANSION; 6 expansions proposed, 1 accepted (encrypted secrets v1), 5 skipped, 1 strategic posture lock (private-only forever); 8 architecture/security/test findings absorbed |
| Codex Review | `/codex review` | Independent 2nd opinion | 1 | issues_found | 19 issues raised; revisions absorbed |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_found | Mode FULL_REVIEW; complexity-check confirmed cathedral; 16 findings (4 arch, 5 quality, 9 test gaps, 1 perf); adapter contract restructured, 5s debounce push trigger, crypto split into 4 files, single SyncError + code, 9 test additions, manifest schema locked, HLC packing format spec'd, perf SLOs added |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

**CEO REVIEW — accepted scope changes:**

- **Encrypted secrets in v1** (was deferred to v2). Per-account sync
  passphrase, PBKDF2-600k (OWASP 2024), AES-GCM, encrypted-fields
  envelope `{c, i, s, alg, h}` with SHA-256 sidecar. Encryption sits in
  per-adapter `pack`/`unpack`. Tauri keychain native; web per-session
  Web Crypto subtle; never localStorage. Lazy first-prompt on first
  encrypted-field push/pull. Forgot-passphrase wipes server-side
  envelopes + rotates salt; user re-enters secrets per device. Wrong
  passphrase preserves local plaintext, surfaces toast.
- **Replicas reuse signed-URL upload pattern** (matches book path);
  bypasses CF Workers body limit; supports 1+ GB.
- **`crdt_merge_replica()` SECURITY DEFINER** must explicitly assert
  `auth.uid() = user_id` inside the function body (not just RLS).
- **`schemaVersion` bounds** are two-sided: `minSupported ≤ x ≤ maxKnown`.
- **Day-1 observability** ships with the full metric set (push/pull
  totals by outcome, crdt_merge_duration, encryption_failures,
  manifest_commit_failures, hlc_skew_rejections); alerts on encryption
  and skew spikes.
- **Feature flag** `ENABLE_REPLICA_SYNC` gates v1; staged rollout
  dev → 5% → 25% → 50% → 100% over ~3 weeks.
- **Test additions:** crypto round-trip, SHA-256 sidecar, wrong
  passphrase, forgot-passphrase wipe, cross-platform key-derivation
  parity, manifest atomicity, 1+ GB upload regression, RLS guard test.
- **`crdt.ts` README** — knowledge concentration mitigation.
- **Error & rescue map** consolidated as a first-class section
  (previously implicit).

**CEO REVIEW — strategic posture locks (permanent, not deferrals):**

- **Private-only forever.** No cross-user content sharing. The
  polymorphic `replicas` table is internal infrastructure, not a public
  API. Any future cross-user-visibility feature requires a fresh
  architecture review.

**CEO REVIEW — explicitly skipped (not in scope):**

- First-run "Migrate from another device" wizard (deferred to follow-up).
- Per-device naming + Manage Devices UI.
- Bandwidth-aware sync (Wi-Fi-only, charging-only).
- Sync status indicator (breathing dot).
- Audit log for sensitive ops (deferred to v2).

**CODEX:** 19 substantive findings, all incorporated:

- Free-form `kind` → server-managed allowlist with per-kind JSON schemas,
  size/field limits, filename validation, per-user quotas. Tenet 1 rewritten.
- `kind` enum → server CHECK constraint and `kinds_allowlist` table.
- API-level fetch-then-upsert merge → atomic SQL UPSERT with `crdt_merge_replica()`
  Postgres function, one statement.
- Deletion-revival via "field write > tombstone" → remove-wins tombstones with
  explicit reincarnation tokens for re-import.
- Single-position fractional index → per-position rows with `(position,
  actorId, replicaId)` deterministic tie-break.
- Trusted client HLC → server-side ±60s skew clamp + client repair.
- HLC in localStorage only → IndexedDB / Tauri keyring with re-derivation
  fallback from remote `max(updated_at_ts)`.
- "Add one branch in sync.ts" understatement → honest protocol upgrade
  acknowledged; new `/api/sync/replicas` endpoint with per-kind validation.
- TransferManager "discriminator" → real refactor of `TransferItem`,
  `cloudService.uploadFileToCloud` (no more `File.name` smuggling), new
  `storage.uploadReplicaFile` API.
- `partialMD5` weak identity → `partialMD5 + byteSize + filename mix` in v1;
  optional background `strongHash` deferred.
- Manifest atomicity gap → upload state machine with `manifest_jsonb`
  populated last; row only `downloadable` after manifest commits.
- "Rehash legacy entries" hand-wavy → staged migration with `.legacy/<old-id>/`
  backup directory, reference rewrites, validate-then-swap.
- Unavailable/reimport revival → explicit reincarnation path described.
- Phasing inverted → dictionary-only end-to-end first (PR 1); generic
  primitives extracted in PR 2 after a second kind proves the abstraction.
- "One-file change for new kinds" tenet **dropped** — adding a kind is now a
  coordinated client+server PR.
- OPDS encryption was deferred to v2 in the Codex revision; the **CEO
  review pulled it forward to v1** because shipping plaintext OPDS
  metadata + per-device password re-entry was deemed worse UX than
  shipping the crypto infra in PR 1.

**CROSS-MODEL:** Codex and the CEO review converge on "atomic Postgres
merge", "remove-wins tombstones", "server-allowlisted kinds",
"manifest atomicity", "TransferManager refactor scope is real, not
discriminator-trivial". They diverge on encryption phase: Codex
recommended deferring v1 encryption to avoid coupling sync foundations
with crypto UX; CEO review judged the OPDS-plaintext-or-password-prompt-per-device
UX cost too high and pulled encryption into v1. Net: ship encryption
infra in PR 1; OPDS adapter that consumes it ships in PR 4.

**ENG REVIEW — accepted refinements:**

- **`ReplicaAdapter` restructured** into core + optional
  `BinaryCapability` + optional `LifecycleHooks`. Reduces decision points
  per adapter; metadata-only adapters (`opds_catalog`,
  `dict_provider_pref`, `dict_web_search`) omit `binary` entirely.
- **Push trigger:** 5s debounce + immediate flush on
  `visibilitychange` and `online` events. Notion/Figma-style cadence.
- **Crypto module split** into 4 files (`derive`, `encrypt`,
  `passphrase`, `envelope`) under `src/libs/crypto/`. Each ≤ 100 LOC,
  single responsibility.
- **Sync subscription extracted** as `useReplicaSubscription(kind,
  store)` hook, not inlined into `customDictionaryStore.ts`. Reusable
  by future kinds' stores.
- **Single `SyncError` base class** with `code: SyncErrorCode` enum;
  replaces the 19-class hierarchy. Single `instanceof` check; switch on
  `.code` for handling.
- **HLC always in IndexedDB**, separated from passphrase storage
  (Tauri keychain native; web ephemeral non-extractable Web Crypto
  key). High-write-rate counter does NOT live in keychain.
- **Forgot-passphrase + offline Device B:** B preserves local plaintext
  when it later sees wiped envelopes; offers to push under the new
  passphrase after re-prompt.
- **Manifest schema locked:**
  `{filename: string, byteSize: number, partialMd5: string, mtime?:
  number}[]` plus a `schemaVersion`. Filename server-validated.
- **HLC packing format specified:**
  `${physicalMs.toString(16).padStart(13, '0')}-${counter.toString(16).padStart(8, '0')}-${deviceId}`.
  Lexicographic = temporal (invariant test).
- **Postgres `crdt_merge_replica()` preserves unknown fields** —
  forwards-compat for schemaVersion bumps.
- **Per-kind quotas live in `replicaSchemas.ts`** (Zod) — single source
  of truth; server reads at request time.
- **9 additional tests** added to Verification: push trigger, HLC
  packing invariant, unknown-field preservation, registry
  double-registration, error code → UX mapping, TransferManager book
  regression, `assertNever` exhaustiveness, per-kind quota enforcement,
  concurrent same-field tiebreak.
- **Performance SLOs documented:** push p95 < 500ms (≤50 rows
  broadband); pull p95 < 1s (≤1000 rows); merge fn p99 < 50ms/row at
  100-row batch; 1+GB upload ≥ 80% network capacity. PBKDF2 Web Worker
  offload deferred to v2 if real-device telemetry shows jank.

**UNRESOLVED:**

- 2 open decisions remain (per-device sync override; strong full-stream
  hash). Items 1, 4, 5 resolved via CEO review; pre-existing items 2, 3
  remain.
- `/plan-design-review` not yet run (recommended after PR 1 has visual
  surfaces to review).
- `/codex review` re-run on the revised plan would catch any drift
  introduced by CEO + eng review changes; recommended but not required.

**POST-PR-3 ARCHITECTURE REFINEMENT (during PR 4 build):**

Questioned why each scalar setting needed its own kind. Insight: the
CRDT model is per-field LWW within a row, so 1 row × N fields and N
rows × 1 field have identical conflict semantics for scalars. The
`dict_provider_pref` adapter (one boolean field per provider) was the
canary — it would have been a 100-LOC adapter for a single boolean.
Generalizing: any scalar setting collapses into a single bundled
`settings` row with a server-managed field whitelist, using namespaced
field keys (`providerEnabled.<id>`, `syncCategories.<id>`,
`shortcut.<action>`) for flat maps.

What does NOT collapse: collections of independent records (OPDS
catalogs, dictionaries, fonts, textures, web searches) — each element
needs independent identity, tombstones, and per-element CRDT envelopes
to survive concurrent add/remove on different devices. And ordered
lists (`providerOrder`) — concurrent rename + reorder must preserve
both sides, which a single-field array can't do.

Plan changes absorbed:

- **New tenet 8** captures the scalar-vs-collection rule.
- **Per-kind allowlist updated:** added `settings` (singleton); removed
  `dict_provider_pref` (folds into settings).
- **Phasing rewritten:** PR 4 split into 4a (encrypted-field session
  wiring) + 4b (opds_catalog plaintext) + 4c (opds_catalog encrypted
  credentials + passphrase UX). PR 5 becomes the bundled `settings`
  kind — collapses what was previously planned as PRs 5 + 6+. PR 6 =
  `dict_provider_position` (still needs per-element rows). PR 7 =
  `dict_web_search`. PR 8+ = incremental whitelist additions, no new
  adapters for scalar settings.
- **Sync categories** become a flat map inside the `settings` bundle
  (`syncCategories.<kind>`); the standalone `sync_pref` kind hinted at
  in the original plan is no longer needed.

Net: ~70% LOC reduction on the remaining roadmap (no per-kind adapters
for `pref`, `theme`, `shortcut`, `annotation_rule`, etc.). No change to
PRs 1–3 (already shipped) or PR 4a (already merged as #4084).

**VERDICT:** CEO + ENG CLEARED — plan is implementation-ready. Codex
review reshaped the architecture; CEO review reshaped the scope; eng
review locked implementation details (adapter shape, push trigger,
file layout, error model, test coverage, manifest schema, perf SLOs);
the post-PR-3 refinement collapsed the long-tail per-kind adapters
into a single bundled `settings` kind. Next step: complete PR 4b/4c,
then ship PR 5.
