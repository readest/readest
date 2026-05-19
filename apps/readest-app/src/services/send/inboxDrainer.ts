import type { DBSendInboxItem } from '@/types/sendRecords';

/**
 * Side-effect ports the drainer needs. The Supabase RPC calls, the payload
 * download, and the import pipeline are injected so the orchestration here is
 * unit-testable and free of React/network coupling. The `useInboxDrainer` hook
 * builds the real adapter from app context.
 */
export interface InboxDrainerDeps {
  /** `claim_inbox_item` RPC — claims the oldest drainable row, or null. */
  claimItem: () => Promise<DBSendInboxItem | null>;
  /** `renew_inbox_claim` RPC — refreshes the lease mid-job. */
  renewClaim: (id: string) => Promise<boolean>;
  /** `complete_inbox_item` RPC — terminal success. */
  completeItem: (id: string) => Promise<boolean>;
  /** `fail_inbox_item` RPC — increments attempts; retries or fails terminally. */
  failItem: (id: string, error: string) => Promise<boolean>;
  /** Resolve a claimed item into an EPUB-or-native File ready for import. */
  resolvePayload: (item: DBSendInboxItem) => Promise<File>;
  /** Run the shared import pipeline (wraps ingestFile + persistence + push). */
  importItem: (file: File, item: DBSendInboxItem) => Promise<void>;
  /** Best-effort R2 payload cleanup after a terminal success. */
  deletePayload?: (item: DBSendInboxItem) => Promise<void>;
}

export interface DrainResult {
  processed: number;
  failed: number;
}

/** How often to refresh a 15-minute lease during a long conversion/upload. */
export const LEASE_RENEW_INTERVAL_MS = 5 * 60 * 1000;

/** Max items drained per pass, so a large backlog never freezes a sync cycle. */
export const DEFAULT_MAX_ITEMS_PER_PASS = 5;

/**
 * Drain pending inbox items one at a time. Each item is claimed via the
 * lease RPC (so only one device processes it), kept alive with a heartbeat,
 * imported through the shared pipeline, then marked done — or failed, which
 * the RPC turns into a retry or a terminal failure after three attempts.
 *
 * importItem is expected to be idempotent (importBook dedups by hash), so a
 * retry after a partial failure never produces a duplicate book.
 */
export async function drainInbox(
  deps: InboxDrainerDeps,
  maxItems: number = DEFAULT_MAX_ITEMS_PER_PASS,
): Promise<DrainResult> {
  let processed = 0;
  let failed = 0;

  for (let i = 0; i < maxItems; i++) {
    const item = await deps.claimItem();
    if (!item) break;

    const heartbeat = setInterval(() => {
      void deps.renewClaim(item.id);
    }, LEASE_RENEW_INTERVAL_MS);

    try {
      const file = await deps.resolvePayload(item);
      await deps.importItem(file, item);
      clearInterval(heartbeat);
      await deps.completeItem(item.id);
      if (deps.deletePayload) {
        // The book is already imported; a failed cleanup only leaves an
        // orphan R2 object, so never let it fail the item.
        try {
          await deps.deletePayload(item);
        } catch (err) {
          console.warn('Inbox payload cleanup failed:', err);
        }
      }
      processed++;
    } catch (err) {
      clearInterval(heartbeat);
      await deps.failItem(item.id, err instanceof Error ? err.message : String(err));
      failed++;
    }
  }

  return { processed, failed };
}
