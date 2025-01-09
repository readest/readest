import { supabase } from '@/utils/supabase';
import { Book, BookConfig, BookNote, BookDataRecord } from '@/types/book';
import { READEST_WEB_BASE_URL } from '@/services/constants';
import { isWebAppPlatform } from '@/services/environment';

// Develop Sync API only in development mode and web platform
// with command `pnpm dev-web`
const SYNC_API_ENDPOINT =
  process.env['NODE_ENV'] === 'development' && isWebAppPlatform()
    ? '/api/sync'
    : `${READEST_WEB_BASE_URL}/api/sync`;

export type SyncType = 'books' | 'configs' | 'notes';
export type SyncOp = 'push' | 'pull' | 'both';

interface BookRecord extends BookDataRecord, Book {}
interface BookConfigRecord extends BookDataRecord, BookConfig {}
interface BookNoteRecord extends BookDataRecord, BookNote {}

export interface SyncResult {
  books: BookRecord[] | null;
  notes: BookNoteRecord[] | null;
  configs: BookConfigRecord[] | null;
}

export interface SyncData {
  books?: Partial<BookRecord>[];
  notes?: Partial<BookNoteRecord>[];
  configs?: Partial<BookConfigRecord>[];
}

export class SyncClient {
  /**
   * Pull incremental changes since a given timestamp (in ms).
   * Returns updated or deleted records since that time.
   */
  async pullChanges(since: number, type?: SyncType, book?: string): Promise<SyncResult> {
    const token = await this.getAccessToken();
    if (!token) throw new Error('Not authenticated');

    const url = `${SYNC_API_ENDPOINT}?since=${encodeURIComponent(since)}&type=${type ?? ''}&book=${book ?? ''}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

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
    const token = await this.getAccessToken();
    if (!token) throw new Error('Not authenticated');

    const res = await fetch(SYNC_API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(`Failed to push changes: ${error.error || res.statusText}`);
    }

    return res.json();
  }

  private async getAccessToken(): Promise<string | null> {
    // In browser context there might be two instances of supabase one in the app route
    // and the other in the pages route, and they might have different sessions
    // making the access token invalid for API calls. In that case we should use localStorage.
    if (isWebAppPlatform()) {
      return localStorage.getItem('token') ?? null;
    }
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token ?? null;
  }
}
