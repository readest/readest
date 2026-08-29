import { BookNote } from '@/types/book';
import { NotionSettings } from '@/types/settings';
import { NOTION_API_BASE_URL, NOTION_API_VERSION } from '@/services/constants';
import { isTauriAppPlatform } from '@/services/environment';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

type NotionResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; message: string; isNetworkError: boolean };

interface NotionBlock {
  object: 'block';
  type: string;
  [key: string]: unknown;
}

interface NotionChildDatabase {
  id: string;
  type: 'child_database';
  [key: string]: unknown;
}

interface NotionPage {
  id: string;
  [key: string]: unknown;
}

/**
 * Minimal Notion API client for pushing annotations to a database, ported
 * from Koodo Reader's `NotionSync` implementation (find-or-create a page per
 * book, then append one block group per highlight). Uses the same Notion API
 * version string Koodo uses so page/database shapes stay consistent.
 */
export class NotionClient {
  private config: NotionSettings;

  constructor(config: NotionSettings) {
    this.config = config;
  }

  private get token(): string {
    return this.config.accessToken.trim();
  }

  private async request(
    path: string,
    options: { method?: 'GET' | 'POST' | 'PATCH'; body?: string } = {},
  ): Promise<Response> {
    const { method = 'GET', body } = options;
    const headers = {
      Authorization: `Bearer ${this.token}`,
      'Notion-Version': NOTION_API_VERSION,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    };
    if (isTauriAppPlatform()) {
      return tauriFetch(`${NOTION_API_BASE_URL}${path}`, { method, headers, body });
    }
    // Web build: Notion sends no CORS headers, so a browser cannot call it
    // directly. Route through the same-origin proxy (mirrors the
    // azure-translate / hardcover proxies in Readest).
    return globalThis.fetch(`/api/notion${path}`, { method, headers, body });
  }

  private async toResult<T>(res: Response, parse: () => Promise<T>): Promise<NotionResult<T>> {
    if (res.ok) {
      try {
        return { ok: true, value: await parse() };
      } catch {
        return { ok: true, value: undefined as T };
      }
    }
    const text = await res.text().catch(() => '');
    let message = `HTTP ${res.status}`;
    try {
      const err = JSON.parse(text);
      message = err.message || err.detail || JSON.stringify(err) || message;
    } catch {
      if (text) message = text;
    }
    return { ok: false, status: res.status, message, isNetworkError: false };
  }

  /** Validates the integration token by asking Notion for the bot's own user. */
  async validateToken(): Promise<{ valid: boolean; isNetworkError?: boolean }> {
    try {
      const res = await this.request('/users/me');
      return { valid: res.status === 200 };
    } catch {
      return { valid: false, isNetworkError: true };
    }
  }

  /**
   * When the configured `databaseId` is actually a page, resolve the child
   * database underneath it (Koodo Reader supports either directly). Returns
   * the child database id, or null when none exists.
   */
  async resolveDatabaseId(pageId: string): Promise<string | null> {
    const res = await this.request(`/blocks/${pageId}/children`);
    const result = await this.toResult<NotionChildDatabase | null>(res, async () => {
      const json = (await res.json()) as { results?: NotionChildDatabase[] };
      return (json.results ?? []).find((b) => b.type === 'child_database') ?? null;
    });
    if (!result.ok) {
      console.error(`[Notion] resolveDatabaseId failed for page ${pageId}: ${result.message}`);
      return null;
    }
    return result.value?.id ?? null;
  }

  /** Find a page whose title equals `bookTitle` in the database, or create it. */
  async findOrCreatePage(databaseId: string, bookTitle: string): Promise<string | null> {
    const queryRes = await this.request(`/databases/${databaseId}/query`, {
      method: 'POST',
      body: JSON.stringify({
        filter: { property: 'title', title: { equals: bookTitle } },
      }),
    });
    const queryResult = await this.toResult<NotionPage | null>(queryRes, async () => {
      const json = (await queryRes.json()) as { results?: NotionPage[] };
      return (json.results ?? [])[0] ?? null;
    });

    if (queryResult.ok && queryResult.value) return queryResult.value.id;

    if (!queryResult.ok) {
      // Koodo's tolerance: if the id is a page, not a database, resolve the
      // child database and retry once.
      if (queryResult.status === 400) {
        const childDb = await this.resolveDatabaseId(databaseId);
        if (childDb && childDb !== databaseId) return this.findOrCreatePage(childDb, bookTitle);
      }
      console.error(
        `[Notion] Database query failed for "${databaseId}" (book: "${bookTitle}"): ${queryResult.message}`,
      );
      return null;
    }

    const createRes = await this.request('/pages', {
      method: 'POST',
      body: JSON.stringify({
        parent: { database_id: databaseId },
        properties: {
          title: { title: [{ text: { content: bookTitle } }] },
        },
      }),
    });
    const createResult = await this.toResult<NotionPage>(createRes, async () => createRes.json());
    if (!createResult.ok) {
      console.error(
        `[Notion] Failed to create page for book "${bookTitle}": ${createResult.message}`,
      );
      return null;
    }
    return createResult.value.id;
  }

  /**
   * Append one highlight's blocks to a page. `chapter` is the resolved TOC
   * label and becomes a heading_3 block when present (mirrors Koodo's layout:
   * divider + chapter heading + quote + note + gray "Added on" line).
   */
  async appendBlocks(
    pageId: string,
    note: BookNote,
    chapter?: string,
    includeChapterHeading = true,
  ): Promise<boolean> {
    const hasNote = !!note.note && note.note.length > 0;
    const blocks: NotionBlock[] = [];

    blocks.push({ object: 'block', type: 'divider', divider: {} });
    if (includeChapterHeading && chapter) {
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: { rich_text: [{ type: 'text', text: { content: chapter } }] },
      });
    }
    blocks.push({
      object: 'block',
      type: 'quote',
      quote: { rich_text: [{ type: 'text', text: { content: note.text || '' } }] },
    });
    if (hasNote) {
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: `📝 ${note.note}` } }],
        },
      });
    }
    blocks.push({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [
          {
            type: 'text',
            text: { content: `Added on ${formatNotionDate(note.createdAt)}` },
            annotations: { italic: true, color: 'gray' },
          },
        ],
      },
    });

    const res = await this.request(`/blocks/${pageId}/children`, {
      method: 'PATCH',
      body: JSON.stringify({ children: blocks }),
    });
    const result = await this.toResult<unknown>(res, async () => null);
    if (!result.ok) {
      console.error(`[Notion] Failed to append blocks to page ${pageId}: ${result.message}`);
      return false;
    }
    return true;
  }

  /**
   * Push syncable notes for a book. `chapterForNote` resolves each note's
   * chapter label (null means "no chapter heading"). Returns the number of
   * notes successfully pushed.
   */
  async pushNotes(
    notes: BookNote[],
    bookTitle: string,
    chapterForNote: (note: BookNote) => string | null,
  ): Promise<{ success: boolean; message?: string; isNetworkError?: boolean }> {
    const syncable = notes.filter(
      (n) => (n.type === 'annotation' || n.type === 'excerpt') && !n.deletedAt && n.text,
    );
    if (syncable.length === 0) return { success: true };

    if (!this.config.databaseId.trim()) {
      return { success: false, message: 'No Notion database configured' };
    }

    try {
      const pageId = await this.findOrCreatePage(this.config.databaseId.trim(), bookTitle);
      if (!pageId) return { success: false, message: 'Notion page lookup failed' };

      const includeChapterHeading = this.config.includeChapterHeading ?? true;
      for (const note of syncable) {
        const chapter = chapterForNote(note) ?? undefined;
        const ok = await this.appendBlocks(pageId, note, chapter, includeChapterHeading);
        if (!ok) return { success: false, message: 'Notion append failed' };
      }
      return { success: true };
    } catch (e) {
      return { success: false, message: (e as Error).message, isNetworkError: true };
    }
  }
}

function formatNotionDate(timestamp: number): string {
  const d = new Date(timestamp);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
