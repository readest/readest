---
name: wordlens-sync-incremental-5737
description: "wordlens:sync now diffs the CDN manifest's sha256 and uploads only changed packs; manifest is skipped when a pack fails"
metadata: 
  node_type: memory
  type: project
  originSessionId: e4c7a4f1-f9d0-4f42-85e8-baf26235aa7d
  modified: 2026-08-16T07:22:52.514Z
---

PR #5737 (2026-08-16) made `pnpm wordlens:sync` incremental. It used to re-upload all 15 packs
(~20 MB) on every run even when one pair changed.

The published manifest at `https://cdn.readest.com/wordlens/manifest.json` already carries every
pack's `sha256`, so the script fetches it and diffs. Adding `en-vi` uploads 652 KB, not 20 MB.

- `planSync(local, remote, {force})` is pure and unit tested — that is the seam to change.
- Unreachable remote manifest (first sync, offline) falls back to a FULL upload. Safe direction:
  a stale manifest can only cause over-uploading, never a skipped change.
- `--force` exists for the one case the diff can't see: manifest is current but an object was
  deleted from the bucket.
- **Fixed a real invariant break:** the script's header always claimed "manifest LAST so it never
  points at a missing pack", but it uploaded the manifest even after pack failures. It now skips
  the manifest entirely when any pack fails.

**Review follow-up, PR #5738:** the first version had a real gap CodeRabbit caught. RETIRING a
pair changes only the manifest (every remaining pack stays byte-identical), so `planSync` returns
[] and the early return skipped the manifest too, leaving the CDN advertising the dropped pack.
Fixed with `manifestChanged(local, remote)`, which compares schemaVersion + each pack's
`file -> sha256`, ignoring order and derived bytes/entries. A no-pack-change run now republishes
the manifest alone. Same PR normalized the exec guard to `pathToFileURL(resolve(argv[1])).href`;
`build-wordlens-data.mjs` still has the unnormalized `file://${argv[1]}` form.

**Gotcha:** `sync-wordlens-r2.mjs` called `main()` unconditionally at module scope, so importing
it in a test ran the CLI and hit `process.exit(1)`. Now guarded by the
`import.meta.url === file://${process.argv[1]}` check that `build-wordlens-data.mjs` already used.
Any new `scripts/*.mjs` that tests import needs that guard.

Related: [[wordlens-en-vi-pack-5737]].
