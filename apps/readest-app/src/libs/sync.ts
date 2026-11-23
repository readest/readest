import { Book, BookConfig, BookNote, BookDataRecord } from '@/types/book';
import { getAPIBaseUrl } from '@/services/environment';
import { getAccessToken } from '@/utils/access';
import { fetchWithTimeout } from '@/utils/fetch';

const SYNC_API_ENDPOINT = getAPIBaseUrl() + '/sync';

/**
 * Books per push request. A pushed book is about 1-5 KB with its parsed
 * metadata, so a bulk-imported library sent in one request went over the
 * server's body limit (1 MB before #7814, still the limit on servers not yet
 * updated) and failed on every sync. 100 books stay well under it.
 */
export const BOOKS_PUSH_BATCH_SIZE = 100;

export type SyncType = 'books' | 'configs' | 'notes' | 'stats';
export type SyncOp = 'push' | 'pull' | 'both';

interface BookRecord extends BookDataRecord, Book {}
interface BookConfigRecord extends BookDataRecord, BookConfig {}
interface BookNoteRecord extends BookDataRecord, BookNote {}

export interface StatBookRecord {
  user_id?: string;
  book_hash: string;
  title: string;
  authors: string;
  updated_at?: string;
  updated_at_ms?: number; // epoch ms, attached by the GET response for cursor math
  // Set when the book's statistics were deleted: its events read before then are gone.
  deleted_at?: string | null;
  deleted_at_ms?: number; // epoch ms of deleted_at, attached by the GET response
}

export interface StatPageRecord {
  user_id?: string;
  book_hash: string;
  page: number;
  start_time: number;
  duration: number;
  total_pages: number;
  ext?: unknown;
  updated_at?: string;
  updated_at_ms?: number; // epoch ms, attached by the GET response for cursor math
  deleted_at?: string | null;
  deleted_at_ms?: number; // set by the GET response when the book's statistics were deleted
}

export interface SyncResult {
  books: BookRecord[] | null;
  notes: BookNoteRecord[] | null;
  configs: BookConfigRecord[] | null;
  statBooks?: StatBookRecord[] | null;
  statPages?: StatPageRecord[] | null;
}

export type SyncRecord = BookRecord & BookConfigRecord & BookNoteRecord;

export interface SyncData {
  books?: Partial<BookRecord>[];
  notes?: Partial<BookNoteRecord>[];
  configs?: Partial<BookConfigRecord>[];
  statBooks?: StatBookRecord[];
  statPages?: StatPageRecord[];
}

export class SyncClient {
  /**
   * Pull incremental changes since a given timestamp (in ms).
   * Returns updated or deleted records since that time.
   */
  async pullChanges(
    since: number,
    type?: SyncType,
    book?: string,
    metaHash?: string,
    limit?: number,
  ): Promise<SyncResult> {
    const token = await getAccessToken();
    if (!token) throw new Error('Not authenticated');

    const limitParam = limit && limit > 0 ? `&limit=${encodeURIComponent(limit)}` : '';
    const url = `${SYNC_API_ENDPOINT}?since=${encodeURIComponent(since)}&type=${type ?? ''}&book=${book ?? ''}&meta_hash=${metaHash ?? ''}${limitParam}`;
    const res = await fetchWithTimeout(
      url,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      15000,
    );

    if (!res.ok) {
      const error = await res.json();
      throw new Error(`Failed to pull changes: ${error.error || res.statusText}`);
    }

    return res.json();
  }

  /**
   * Push local changes to the server.
   * Uses last-writer-wins logic as implemented on the server side.
   * Books go BOOKS_PUSH_BATCH_SIZE per request, returned as one result; the
   * first failed request throws. Which unsent books a later push picks up
   * again is getNewBooks' cursor rule (#7824).
   */
  async pushChanges(payload: SyncData): Promise<SyncResult> {
    const books = payload.books ?? [];
    const result = await this.pushRequest(
      payload.books ? { ...payload, books: books.slice(0, BOOKS_PUSH_BATCH_SIZE) } : payload,
    );
    for (let i = BOOKS_PUSH_BATCH_SIZE; i < books.length; i += BOOKS_PUSH_BATCH_SIZE) {
      const batch = await this.pushRequest({ books: books.slice(i, i + BOOKS_PUSH_BATCH_SIZE) });
      result.books = [...(result.books ?? []), ...(batch.books ?? [])];
    }
    return result;
  }

  private async pushRequest(payload: SyncData): Promise<SyncResult> {
    const token = await getAccessToken();
    if (!token) throw new Error('Not authenticated');

    const res = await fetchWithTimeout(
      SYNC_API_ENDPOINT,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      },
      15000,
    );

    if (!res.ok) {
      const error = await res.json();
      throw new Error(`Failed to push changes: ${error.error || res.statusText}`);
    }

    return res.json();
  }
}
