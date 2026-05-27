import type { Book } from '@/types/book';

// --- Constants ---

export const MAX_PAGES_PER_FEED = 5;
export const MAX_KNOWN_ENTRIES = 2000;
export const MAX_RETRY_ATTEMPTS = 3;
export const RETRY_BACKOFF_MS = 60_000;
export const DOWNLOAD_CONCURRENCY = 3;
export const OPDS_SUBSCRIPTIONS_DIR = 'OPDS';
// How often to check subscribed feeds for new items, in addition to the
// app-startup check and pull-to-refresh trigger.
export const AUTO_CHECK_INTERVAL_MS = 5 * 60 * 1000;

// --- Types ---

export interface PendingItem {
  entryId: string;
  title: string;
  acquisitionHref: string;
  mimeType: string;
  updated?: string;
  baseURL: string;
}

export interface FailedEntry {
  entryId: string;
  href: string;
  title: string;
  attempts: number;
  lastAttemptAt: number;
}

export interface OPDSSubscriptionState {
  catalogId: string;
  lastCheckedAt: number;
  knownEntryIds: string[];
  failedEntries: FailedEntry[];
}

export interface SyncResult {
  newBooks: Book[];
  totalNewBooks: number;
  errors: Array<{ catalogId: string; catalogName: string; error: string }>;
}

// --- Helpers ---

export function isRetryEligible(entry: FailedEntry): boolean {
  if (entry.attempts >= MAX_RETRY_ATTEMPTS) return false;
  const backoff = RETRY_BACKOFF_MS * Math.pow(2, entry.attempts);
  return Date.now() - entry.lastAttemptAt >= backoff;
}
