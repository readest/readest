import { Book, BookConfig, BookNote, BookDataRecord } from '@/types/book';
import { getAPIBaseUrl } from '@/services/environment';
import { getAccessToken } from '@/utils/access';
import { fetchWithTimeout } from '@/utils/fetch';

const SYNC_API_ENDPOINT = getAPIBaseUrl() + '/sync';

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
  deleted_at?: string | null;
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
   */
  async pushChanges(payload: SyncData): Promise<SyncResult> {
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
