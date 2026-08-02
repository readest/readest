---
name: metadata-field-lww-5438
description: "#5438 MERGED #5442; metadata edits (language for TTS) clobbered by page-turn LWW; metadata_updated_at field-level merge; Android half was just unshipped #5314"
metadata: 
  node_type: memory
  type: project
  originSessionId: 76139784-2f55-426b-8763-2d2786a7ace2
  modified: 2026-08-02T13:47:45.681Z
---

# #5438 — RSS feed metadata edits never propagate; feeds missing on Android

Two symptoms, two causes:

1. **Feeds missing on Android**: Play Store 0.11.20 predates the #5314 fix
   (`git merge-base --is-ancestor` showed the fix is NOT in v0.11.20), so the
   old `uploadedAt` adoption gate still drops fileless feed books there. No
   code fix; ships with the next release.
2. **Metadata edits lost everywhere**: the metadata group (title, author,
   tags, metadata JSON incl. language) had only whole-row LWW under
   `updatedAt`, which page-turn progress dominates (`updateBookProgress`
   bumps it locally; the configs piggyback bumps it server-side). Any device
   reading the book after an edit pushes a stale row with newer `updatedAt`
   and the edit is reverted. Feed books are read daily on several devices, so
   near-deterministic. Third instance of the [[reading-status-lww-4634]] /
   cover #4544 hazard class.

**Fix (MERGED PR #5442):** migration
018 `books.metadata_updated_at`; `getBookWithUpdatedMetadata` + ingest
subject-tag stamp it; server `resolveMetadataMerge(client, server,
clientRowWins)` + `bookMetadataChanged` no-op guard; client
`pickFresherMetadata` graft in `useBooksSync.updateLibrary`; file-sync
`mergeBookMetadata` clock block; calibre `merge_for_push` stamps
`metadataUpdatedAt` only when `_row_matches_wire` says the group changed.

Non-obvious decisions:

- **Tie (incl. unstamped 0/0) follows the ROW winner**, unlike status/cover
  ties→client. Metadata differs across devices far more easily than
  cover_hash, so ties→client would let any stale legacy push graft its
  metadata onto a newer server row. This keeps legacy rows byte-for-byte on
  old behavior.
- **`primaryLanguage` is not a cloud column and peers never recomputed it** —
  TTS reads `book.primaryLanguage` (useTTSControl), not `metadata.language`.
  The graft recomputes it via `getPrimaryLanguage`, and `processNewBook` also
  sets it when adopting a cloud book with `metadata.language` (otherwise the
  reader later guesses from the PARSED DOC, ignoring the user's edit).
- **The `metadata` json column stores a JSON-string scalar** (pushes write
  `JSON.stringify` output through PostgREST), so server-side string equality
  works and converges after one propagation write; calibre's dict-tolerant
  `_parse_row_metadata` is just defensive.
- **Tags ride the metadata clock**, so every deliberate tag writer must stamp
  (metadata dialog + ingestService subjectTag append). Group membership and
  progress stay on the row clock (#4942, #5067).
- **Deploy order**: production Supabase must run migration 018 before the web
  deploy; inserts explicitly write the column and would fail on a
  pre-migration schema.

Related: [[rss-feed-books-not-syncing-5307]], [[sync-pull-10k-worker-1102]].
