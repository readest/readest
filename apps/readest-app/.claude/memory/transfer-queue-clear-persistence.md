---
name: transfer-queue-clear-persistence
description: "Transfer Queue \"Clear Completed/Failed/All\" reappeared on reload because the hook mutated the store directly and skipped persistQueue"
metadata: 
  node_type: memory
  type: project
  originSessionId: daef2308-58b2-425d-924d-8a405b0e096a
---

Transfer Queue "Clear Completed" (also Clear Failed / Clear All) removed items from the panel but they reappeared next time the queue loaded from `localStorage` (`readest_transfer_queue`).

**Root cause:** `src/hooks/useTransferQueue.ts` called `useTransferStore.getState().clearCompleted()` / `clearFailed()` / `clearAll()` directly — those Zustand actions only mutate in-memory `transfers`, never touching `localStorage`. Only `clearPending` routed through `transferManager.clearPending()`, which calls `this.persistQueue()`. So the persisted copy still held the completed rows and `loadPersistedQueue()` restored them on next init.

**Fix (PR):** added `clearCompleted()`/`clearFailed()`/`clearAll()` to `src/services/transferManager.ts` (each = store action + `this.persistQueue()`, mirroring `clearPending`), and pointed the hook at the manager methods. Tests in `src/__tests__/services/transfer-manager.test.ts` assert both the store and `localStorage` no longer contain the cleared rows.

**Why:** the store is in-memory; `transferManager` is the only layer that persists. Any mutation exposed to the UI must go through the manager (which calls `persistQueue()`), not the store directly, or it won't survive reload.

**How to apply:** when adding a transfer-queue mutation, add a `transferManager` method that pairs the store action with `persistQueue()` and call that from the hook — never call the store's mutating action straight from `useTransferQueue`.
