import { describe, it, expect } from 'vitest';
import { RETRY_BACKOFF_MS, isRetryEligible } from '@/services/opds/types';
import type {
  PendingItem,
  OPDSSubscriptionState,
  FailedEntry,
  SyncResult,
} from '@/services/opds/types';

describe('OPDS types and constants', () => {
  describe('isRetryEligible', () => {
    it('returns true when attempts < max and backoff elapsed', () => {
      const entry: FailedEntry = {
        entryId: 'urn:test:1',
        href: '/dl/1',
        title: 'Test',
        attempts: 1,
        lastAttemptAt: Date.now() - RETRY_BACKOFF_MS * 4,
      };
      expect(isRetryEligible(entry)).toBe(true);
    });

    it('returns false when attempts >= max', () => {
      const entry: FailedEntry = {
        entryId: 'urn:test:1',
        href: '/dl/1',
        title: 'Test',
        attempts: 3,
        lastAttemptAt: 0,
      };
      expect(isRetryEligible(entry)).toBe(false);
    });

    it('returns false when backoff has not elapsed', () => {
      const entry: FailedEntry = {
        entryId: 'urn:test:1',
        href: '/dl/1',
        title: 'Test',
        attempts: 1,
        lastAttemptAt: Date.now(),
      };
      expect(isRetryEligible(entry)).toBe(false);
    });

    it('uses exponential backoff: attempt 2 waits 4x base', () => {
      const entry: FailedEntry = {
        entryId: 'urn:test:1',
        href: '/dl/1',
        title: 'Test',
        attempts: 2,
        lastAttemptAt: Date.now() - RETRY_BACKOFF_MS * 3,
      };
      expect(isRetryEligible(entry)).toBe(false);
    });
  });

  it('type PendingItem has required fields', () => {
    const item: PendingItem = {
      entryId: 'urn:test:1',
      title: 'Test Book',
      acquisitionHref: '/dl/book.epub',
      mimeType: 'application/epub+zip',
      baseURL: 'https://example.com/opds',
    };
    expect(item.entryId).toBe('urn:test:1');
    expect(item.updated).toBeUndefined();
  });

  it('type OPDSSubscriptionState has required fields', () => {
    const state: OPDSSubscriptionState = {
      catalogId: 'cat-1',
      lastCheckedAt: 0,
      knownEntryIds: [],
      failedEntries: [],
    };
    expect(state.catalogId).toBe('cat-1');
  });

  it('type SyncResult has required fields', () => {
    const result: SyncResult = {
      newBooks: [],
      totalNewBooks: 0,
      errors: [],
    };
    expect(result.totalNewBooks).toBe(0);
  });
});
