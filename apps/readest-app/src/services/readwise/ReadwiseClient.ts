import { Book, BookNote, HighlightColor } from '@/types/book';
import { ReadwiseSettings } from '@/types/settings';
import { READWISE_API_BASE_URL } from '@/services/constants';

const READEST_TO_READWISE_COLOR: Record<HighlightColor, string> = {
  red: 'pink',
  yellow: 'yellow',
  green: 'green',
  blue: 'blue',
  violet: 'purple',
};

export class ReadwiseClient {
  private config: ReadwiseSettings;

  constructor(config: ReadwiseSettings) {
    this.config = config;
  }

  private async request(
    endpoint: string,
    options: { method?: 'GET' | 'POST'; body?: string } = {},
  ): Promise<Response> {
    const { method = 'GET', body } = options;
    return fetch(`${READWISE_API_BASE_URL}${endpoint}`, {
      method,
      headers: {
        Authorization: `Token ${this.config.accessToken}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body,
    });
  }

  async validateToken(): Promise<{ valid: boolean; isNetworkError?: boolean }> {
    try {
      const res = await this.request('/auth/');
      return { valid: res.status === 204 };
    } catch {
      return { valid: false, isNetworkError: true };
    }
  }

  async pushHighlights(
    notes: BookNote[],
    book: Book,
  ): Promise<{ success: boolean; message?: string; isNetworkError?: boolean }> {
    const syncable = notes.filter(
      (n) => (n.type === 'annotation' || n.type === 'excerpt') && !n.deletedAt && n.text,
    );
    if (syncable.length === 0) return { success: true };

    const isPublicUrl = (url?: string | null) =>
      !!url && /^https?:\/\/(?!localhost|127\.|asset\.localhost)/.test(url);

    const highlights = syncable.map((note) => ({
      text: note.text!,
      title: book.title,
      author: book.author,
      ...(isPublicUrl(book.coverImageUrl) ? { image_url: book.coverImageUrl } : {}),
      source_type: 'readest',
      category: 'books',
      note: note.note || undefined,
      location: 0,
      location_type: 'none',
      highlighted_at: new Date(note.createdAt).toISOString(),
      highlight_url: `readest://annotation/${book.hash}/${note.id}`,
      color: note.color ? (READEST_TO_READWISE_COLOR[note.color] ?? 'yellow') : 'yellow',
    }));

    try {
      const res = await this.request('/highlights/', {
        method: 'POST',
        body: JSON.stringify({ highlights }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.error('Readwise API error:', res.status, errText);
        let message = `HTTP ${res.status}`;
        try {
          const err = JSON.parse(errText);
          message = err.detail || err.message || JSON.stringify(err) || message;
        } catch {
          if (errText) message = errText;
        }
        return { success: false, message };
      }
      return { success: true };
    } catch (e) {
      return { success: false, message: (e as Error).message, isNetworkError: true };
    }
  }
}
