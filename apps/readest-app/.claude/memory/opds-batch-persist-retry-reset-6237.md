---
name: opds-batch-persist-retry-reset-6237
description: "#6237 batched OPDS sync persistence; batching a loop that reassigns the state it reads reset retry counters and dropped committed books on a throw"
metadata:
  node_type: memory
  type: project
---

PR #6237 (raman325) made `syncCatalog` in `src/services/opds/autoDownload.ts`
persist every `PERSIST_BATCH_SIZE` (10) items instead of once at the end, so an
Android LMK kill mid-sync no longer discards the whole first sync. Correct
shape. Two bugs the batching introduced, both fixed in c64a4fc0c (pushed to the
contributor's fork, fast-forward, NOT a force push). MERGED to main as
d48ad3450 (squash) — merged code carries `priorAttempts` and the
`error?: unknown` return, verified. Never device-tested against a real
large catalog.

1. **Retry counters reset past batch 1.** The loop read
   `state.failedEntries.find(...)` for the prior attempt count, but every batch
   ends with `state.failedEntries = updatedFailedEntries`, and that array is
   seeded with only the **non**-retry-eligible failures. From batch 2 the lookup
   misses exactly the entries it wants -> `attempts` collapses to 1 -> the entry
   never hits `MAX_RETRY_ATTEMPTS`, never enters `knownEntryIds`, and
   `isRetryEligible`'s `RETRY_BACKOFF_MS * 2^attempts` stays pinned at the first
   step. A dead entry is re-downloaded every 5-minute background check forever.
   Retry items are appended AFTER `eligiblePendingItems`, so they reliably land
   past the boundary. Fix: snapshot `new Map(state.failedEntries.map(fe => [fe.entryId, fe.attempts]))`
   before the loop.

2. **A throw in batch k discards batches 1..k-1's books.** They are already on
   disk and in `knownEntryIds`, so no later sync rediscovers them, and
   `queueOPDSBookUploads` never sees them -> never uploaded to cloud. Fix:
   `syncCatalog` returns `{ newBooks, state, error }`; the caller pushes
   `newBooks` then rethrows.

**Generalizable rule:** when you wrap an existing single-pass loop in a batch
loop that persists per batch, audit every `state.X` READ inside it — a write
that used to happen once now happens per batch and poisons later reads. The
loop-carried read/write aliasing is the whole bug class.

**Test notes for `src/__tests__/services/opds-auto-download.test.ts`:**
- `vi.clearAllMocks()` in `beforeEach` does NOT reset `mockImplementation`, and
  the module-level `loadSubscriptionState` mock resolves ONE SHARED object that
  tests mutate. New tests must call the file's `freshStatePerLoad()` helper and
  be placed below it.
- `pnpm test -- <file>` runs the WHOLE suite (the `--` arg is not a filter);
  `pnpm vitest run <file>` fails on `atob` of a missing Supabase env var, so
  there is no quick single-file lane — budget ~95s for the full run.

Related: [[worktree-new-rebases-pr-force-push]] (recipe used to land this on the
contributor's real head without rewriting their commit).
