# `crdt.ts` — Hybrid Logical Clock + per-field LWW

Internal sync primitive for the polymorphic `replicas` table. See
`apps/readest-app/.claude/plans/vivid-orbiting-thimble.md` for the full design.

## What this module does

- Generates **HLC** timestamps that are monotonic per device, absorb remote
  ordering when observed, and survive wall-clock regression.
- Merges replica rows under **field-level LWW** with **remove-wins
  tombstones**.
- Is pure — no IndexedDB, no fetch, no DOM. Persistence is layered on top
  by `replicaSyncManager` and a Tauri/web HLC store.

## HLC packing format

```
0000018e7d6ab5c0-00000007-device-uuid
└── physicalMs ─┘ └counter┘ └─deviceId─┘
    13 hex chars  8 hex      free-form
```

Lexicographic comparison of the packed string matches temporal order:

```
hlcCompare(packA, packB) === -1  ⟺  (msA, ctrA) < (msB, ctrB)
```

This is invariant — see the 1000-sample property test in
`__tests__/libs/crdt.test.ts`.

## Per-field LWW envelope

Each field in `fields_jsonb` is wrapped:

```
{ v: <any json>, t: <Hlc>, s: <deviceId> }
   value          when      who wrote it
```

`mergeFields(local, remote)` keeps the envelope with the larger HLC. Ties
on HLC are broken by `deviceId` lex order (deterministic, both sides
converge).

## Remove-wins tombstones

A `deleted_at_ts` HLC marks the row deleted. **Field writes do NOT revive
a tombstoned row** — that is the unsafe pattern. To revive, use
`withReincarnation(row, token)` which creates a new logical entity.

```
                          deleted_at_ts ≠ null
                                  │
        ┌─ field writes accumulate normally
        │  but the row stays deleted
        │
   reincarnation = 'epoch-N'   ←  explicit token from importer
        │
        ▼
  row is alive again under new logical identity
```

## Merge semantics summary

```
mergeReplica(local, remote):
  fields_jsonb   ← per-field LWW
  deleted_at_ts  ← max(local, remote)         (tombstones never disappear)
  reincarnation  ← LWW by row updated_at_ts
  manifest_jsonb ← whichever side is newer
  schema_version ← max
  updated_at_ts  ← max over fields and tombstone
```

CRDT properties verified by tests:

- `mergeFields(a, b) === mergeFields(b, a)`
- `mergeFields(mergeFields(a, b), c) === mergeFields(a, mergeFields(b, c))`
- `mergeFields(a, a) === a`
- `mergeReplica` is commutative and idempotent

## When you change this module

This is one of the few places in Readest where correctness is
non-negotiable. Bugs cause silent data loss across devices.

- Never weaken any of the four CRDT properties.
- Never let a field write revive a tombstone.
- Never break the HLC packing format (other devices comparing on the
  string format will diverge).
- Add a property test for any new merge rule.
- Re-run `pnpm test src/__tests__/libs/crdt.test.ts` after every change.

## Where things go from here

- `crypto/` (Lane B) — encrypted-field envelopes plug into `setField` /
  `mergeFields` transparently. The CRDT machinery sees opaque
  ciphertext.
- `replicaSyncManager` (Lane E) — owns the HLC generator instance,
  observes remote HLCs on pull, persists snapshots to IndexedDB.
- `crdt_merge_replica()` Postgres function — must implement the same
  merge semantics on the server side, atomically. Tests in PR 1 will
  enforce client/server parity.
