import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { marked, type Token } from 'marked';
import {
  NOTION_API_BASE_URL,
  NOTION_API_VERSION,
  READEST_WEB_BASE_URL,
} from '@/services/constants';
import { isTauriAppPlatform } from '@/services/environment';
import { getAccessToken } from '@/utils/access';
import type { BookNote, HighlightColor } from '@/types/book';
import type { NotionSettings } from '@/types/settings';
import {
  buildAnnotationAppUrl,
  buildAnnotationWebUrl,
  parseAnnotationDeepLink,
} from '@/utils/deeplink';
import { getContentMd5 } from '@/utils/misc';
import { renderNoteTemplate } from '@/utils/note';
import type { NotionNoteMapping, NotionSyncStoreLike } from './NotionSyncStore';

export type { NotionSyncStoreLike } from './NotionSyncStore';

type RequestMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

type ResolveDataSourceResult =
  | { success: true; dataSourceId: string }
  | {
      success: false;
      code: 'invalid_target' | 'multiple_data_sources' | 'network_error';
      message: string;
      isNetworkError?: boolean;
    };

type SyncResult =
  | {
      success: true;
      inserted: number;
      updated: number;
      deleted: number;
      skipped: number;
    }
  | { success: false; message: string; isNetworkError?: boolean };

interface NotionBlock {
  object: 'block';
  id?: string;
  type: string;
  [key: string]: unknown;
}

interface NotionRichText {
  href?: string | null;
  text?: { link?: { url?: string } | null };
}

interface PendingNote {
  note: BookNote;
  payloadHash: string;
  blocks: NotionBlock[];
  newBlockIds: string[];
  staleBlockIds: string[];
}

interface DataSourceContainer {
  data_sources?: Array<{ id: string }>;
}

interface BlockChildrenResponse {
  results?: NotionBlock[];
  has_more?: boolean;
  next_cursor?: string | null;
}

interface PageQueryResponse {
  results?: Array<{ id?: string }>;
  has_more?: boolean;
  next_cursor?: string | null;
}

interface BookPage {
  pageId: string;
  children?: NotionBlock[];
  resetMappings: boolean;
}

interface RemoteNoteGroup {
  noteId: string;
  payloadHash: string;
  blockIds: string[];
  complete: boolean;
}

interface NoteState {
  note: BookNote;
  isDeleted: boolean;
  payloadHash: string;
  blocks: NotionBlock[];
  existing: NotionNoteMapping | null;
}

const MAX_RICH_TEXT_CONTENT_LENGTH = 2_000;
const MAX_RICH_TEXT_ITEMS_PER_BLOCK = 20;
const MAX_BLOCKS_PER_REQUEST = 100;
const MAX_APPEND_BODY_BYTES = 450 * 1024;
const MAX_RATE_LIMIT_RETRIES = 3;
// Earlier releases wrote markers under this path, which opens nothing. They
// are still read so pages synced by those releases are recognized.
const LEGACY_MARKER_ORIGIN = 'https://readest.com';
const LEGACY_MARKER_ROOT = '/notion-sync';
// The sync state a note marker adds to the annotation's web link.
const NOTE_MARKER_PARAM = 'notion';

const READEST_TO_NOTION_COLOR: Record<HighlightColor, string> = {
  red: 'red_background',
  yellow: 'yellow_background',
  green: 'green_background',
  blue: 'blue_background',
  violet: 'purple_background',
};

const quoteColor = (note: BookNote): string =>
  (note.color && READEST_TO_NOTION_COLOR[note.color]) || 'default';

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export const normalizeNotionObjectId = (input: string): string | null => {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let candidate = trimmed;
  try {
    candidate = new URL(trimmed).pathname;
  } catch {
    // A bare id or Notion's title-prefixed path fragment is valid input too.
  }

  const dashedMatches = [
    ...candidate.matchAll(
      /(?:^|[^0-9a-fA-F])([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?=$|[^0-9a-fA-F])/g,
    ),
  ];
  const dashed = dashedMatches.at(-1)?.[1];
  if (dashed) return dashed.replace(/-/g, '').toLowerCase();

  const bareMatches = [
    ...candidate.matchAll(/(?:^|[^0-9a-fA-F])([0-9a-fA-F]{32})(?=$|[^0-9a-fA-F])/g),
  ];
  return bareMatches.at(-1)?.[1]?.toLowerCase() ?? null;
};

const splitText = (text: string): string[] => {
  if (!text) return [''];
  const chunks: string[] = [];
  let chunk = '';
  let length = 0;
  for (const character of text) {
    if (length === MAX_RICH_TEXT_CONTENT_LENGTH) {
      chunks.push(chunk);
      chunk = '';
      length = 0;
    }
    chunk += character;
    length += 1;
  }
  if (chunk || chunks.length === 0) chunks.push(chunk);
  return chunks;
};

type RichTextItem = ReturnType<typeof richTextItems>[number];

const richTextItems = (text: string, annotations?: Record<string, unknown>, link?: string) =>
  splitText(text).map((content) => ({
    type: 'text',
    text: { content, ...(link ? { link: { url: link } } : {}) },
    ...(annotations ? { annotations } : {}),
  }));

const textBlocks = (
  type: 'heading_3' | 'quote' | 'paragraph' | 'callout',
  text: string,
  annotations?: Record<string, unknown>,
  link?: string,
  props?: Record<string, unknown>,
): NotionBlock[] => itemBlocks(type, richTextItems(text, annotations, link), props);

// Joins neighbouring runs that share formatting and link, such as the text
// around a Markdown escape, so a block holds as few rich text items as it can.
const mergeItems = (items: RichTextItem[]): RichTextItem[] => {
  const runs: RichTextItem[][] = [];
  for (const item of items) {
    const run = runs.at(-1);
    const head = run?.[0];
    if (
      run &&
      head &&
      JSON.stringify(head.annotations) === JSON.stringify(item.annotations) &&
      head.text.link?.url === item.text.link?.url
    ) {
      run.push(item);
    } else {
      runs.push([item]);
    }
  }
  return runs.flatMap((run) =>
    richTextItems(
      run.map((item) => item.text.content).join(''),
      run[0]!.annotations,
      run[0]!.text.link?.url,
    ),
  );
};

const itemBlocks = (
  type: string,
  runs: RichTextItem[],
  props?: Record<string, unknown>,
): NotionBlock[] => {
  const items = mergeItems(runs);
  const blocks: NotionBlock[] = [];
  for (let index = 0; index < items.length; index += MAX_RICH_TEXT_ITEMS_PER_BLOCK) {
    blocks.push({
      object: 'block',
      type,
      [type]: { rich_text: items.slice(index, index + MAX_RICH_TEXT_ITEMS_PER_BLOCK), ...props },
    });
  }
  return blocks;
};

const CALLOUT_ICONS: Record<string, string> = {
  NOTE: '📝',
  TIP: '💡',
  IMPORTANT: '❗',
  WARNING: '⚠️',
  CAUTION: '🛑',
};

const inlineItems = (
  tokens: Token[] = [],
  annotations: Record<string, boolean> = {},
  link?: string,
): RichTextItem[] =>
  tokens.flatMap((token) => {
    switch (token.type) {
      case 'strong':
        return inlineItems(token.tokens, { ...annotations, bold: true }, link);
      case 'em':
        return inlineItems(token.tokens, { ...annotations, italic: true }, link);
      case 'del':
        return inlineItems(token.tokens, { ...annotations, strikethrough: true }, link);
      case 'codespan':
        return richTextItems(token.text, { ...annotations, code: true }, link);
      case 'link':
        // Notion rejects relative and non-web links, which would fail the sync.
        return inlineItems(
          token.tokens,
          annotations,
          /^https?:/.test(token.href) ? token.href : link,
        );
      default:
        if ('tokens' in token && token.tokens) return inlineItems(token.tokens, annotations, link);
        return richTextItems(
          'text' in token ? token.text : '',
          Object.keys(annotations).length ? annotations : undefined,
          link,
        );
    }
  });

// Turns the Markdown a note template renders into Notion blocks. Quotes take
// the highlight color and `> [!NOTE]`-style alerts become callouts. A rule is
// dropped: dividers delimit each note's blocks on the page.
const templateBlocks = (markdown: string, color: string): NotionBlock[] =>
  marked.lexer(markdown).flatMap((token): NotionBlock[] => {
    switch (token.type) {
      case 'heading':
        return itemBlocks(`heading_${Math.min(token.depth, 3)}`, inlineItems(token.tokens));
      case 'blockquote': {
        const paragraphs = (token.tokens ?? []).filter((child) => child.type !== 'space');
        const items = paragraphs.flatMap((child, index) => [
          ...(index > 0 ? richTextItems('\n\n') : []),
          ...inlineItems([child]),
        ]);
        const alert = items[0]?.text.content.match(/^\[!(\w+)\]\s*/);
        if (!alert) return itemBlocks('quote', items, { color });
        items[0]!.text.content = items[0]!.text.content.slice(alert[0].length);
        return itemBlocks(
          'callout',
          items.filter((item) => item.text.content),
          {
            icon: { type: 'emoji', emoji: CALLOUT_ICONS[alert[1]!.toUpperCase()] ?? '📝' },
            color: 'gray_background',
          },
        );
      }
      case 'list':
        return token.items.flatMap((item: Token) =>
          itemBlocks(
            token.ordered ? 'numbered_list_item' : 'bulleted_list_item',
            inlineItems([item]),
          ),
        );
      case 'hr':
      case 'space':
        return [];
      default:
        return itemBlocks('paragraph', inlineItems([token]));
    }
  });

/** Renders the same blocks as the built-in layout; the starting point to edit. */
export const DEFAULT_NOTION_NOTE_TEMPLATE = `{% if chapter.title %}
### {{ chapter.title }}
{% endif %}
{{ annotation.text | blockquote }}
{% if annotation.note %}

> [!NOTE]
{{ annotation.note | blockquote }}
{% endif %}`;

interface NoteTemplate {
  source: string;
  bookHash: string;
  title: string;
}

const buildNoteBlocks = (
  note: BookNote,
  chapter: string | null,
  includeChapterHeading: boolean,
  markerUrl?: string,
  template?: NoteTemplate,
): NotionBlock[] => [
  { object: 'block', type: 'divider', divider: {} },
  ...textBlocks(
    'paragraph',
    `Added on ${formatNotionDate(note.createdAt)}`,
    { italic: true, color: 'gray' },
    markerUrl,
  ),
  ...(template
    ? templateBlocks(renderTemplate(note, chapter, template), quoteColor(note))
    : [
        ...(includeChapterHeading && chapter ? textBlocks('heading_3', chapter) : []),
        ...textBlocks('quote', note.text ?? '', undefined, undefined, { color: quoteColor(note) }),
        ...(note.note
          ? textBlocks('callout', note.note, undefined, undefined, {
              icon: { type: 'emoji', emoji: '📝' },
              color: 'gray_background',
            })
          : []),
      ]),
];

// Book text and notes are written literally, as in the built-in layout:
// escaping keeps `__init__`, a leading `#` or a bare URL (`:`) from turning
// into formatting or a link.
const escapeMarkdown = (text: string): string => text.replace(/[\\`*_{}[\]()#+\-.!|<>~:]/g, '\\$&');

// The same variables as the export template, one annotation at a time; the
// annotation link is always the web form, which opens from Notion anywhere.
const renderTemplate = (note: BookNote, chapter: string | null, template: NoteTemplate) => {
  const link = { bookHash: template.bookHash, noteId: note.id, cfi: note.cfi };
  return renderNoteTemplate(template.source, {
    title: escapeMarkdown(template.title),
    chapter: { title: escapeMarkdown(chapter ?? '') },
    annotation: {
      ...note,
      bookHash: template.bookHash,
      link: buildAnnotationWebUrl(link),
      webLink: buildAnnotationWebUrl(link),
      appLink: buildAnnotationAppUrl(link),
      text: escapeMarkdown(note.text || ''),
      note: escapeMarkdown(note.note || ''),
      timestamp: note.updatedAt,
    },
  });
};

// Markers identify the sync's own blocks on a page. They are links readers can
// open: the book in the web reader, and each note's annotation page.
const bookMarkerUrl = (bookHash: string): string => `${READEST_WEB_BASE_URL}/reader/${bookHash}`;

const noteMarkerUrl = (
  bookHash: string,
  note: BookNote,
  payloadHash: string,
  blockCount: number,
): string => {
  const link = buildAnnotationWebUrl({ bookHash, noteId: note.id, cfi: note.cfi });
  return `${link}${link.includes('?') ? '&' : '?'}${NOTE_MARKER_PARAM}=${payloadHash}.${blockCount}`;
};

const blockLinks = (block: NotionBlock): string[] => {
  const value = block[block.type] as { rich_text?: NotionRichText[] } | undefined;
  return (value?.rich_text ?? [])
    .map((item) => item.href ?? item.text?.link?.url ?? null)
    .filter((url): url is string => !!url);
};

const legacyMarkerSegments = (url: string): string[] | null => {
  try {
    const parsed = new URL(url);
    if (parsed.origin !== LEGACY_MARKER_ORIGIN) return null;
    const prefix = `${LEGACY_MARKER_ROOT}/`;
    if (!parsed.pathname.startsWith(prefix)) return null;
    return parsed.pathname
      .slice(prefix.length)
      .split('/')
      .map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }
};

const isBookMarker = (block: NotionBlock, bookHash: string): boolean =>
  blockLinks(block).some((url) => {
    if (url === bookMarkerUrl(bookHash)) return true;
    const segments = legacyMarkerSegments(url);
    return segments?.length === 2 && segments[0] === 'book' && segments[1] === bookHash;
  });

const parseNoteMarker = (
  url: string,
): { bookHash: string; noteId: string; payloadHash: string; blockCount: string } | null => {
  const segments = legacyMarkerSegments(url);
  if (segments) {
    if (segments.length !== 5 || segments[0] !== 'note') return null;
    const [, bookHash = '', noteId = '', payloadHash = '', blockCount = ''] = segments;
    return { bookHash, noteId, payloadHash, blockCount };
  }
  const link = parseAnnotationDeepLink(url);
  if (!link) return null;
  const [payloadHash, blockCount] =
    new URL(url).searchParams.get(NOTE_MARKER_PARAM)?.split('.') ?? [];
  if (!payloadHash || !blockCount) return null;
  return { bookHash: link.bookHash, noteId: link.noteId, payloadHash, blockCount };
};

const noteMarker = (
  block: NotionBlock,
  bookHash: string,
): { noteId: string; payloadHash: string; blockCount: number } | null => {
  for (const url of blockLinks(block)) {
    const marker = parseNoteMarker(url);
    if (marker?.bookHash !== bookHash) continue;
    const blockCount = Number(marker.blockCount);
    if (!Number.isSafeInteger(blockCount) || blockCount < 2) continue;
    return { noteId: marker.noteId, payloadHash: marker.payloadHash, blockCount };
  }
  return null;
};

const responseMessage = async (response: Response): Promise<string> => {
  const text = await response.text().catch(() => '');
  if (!text) return `HTTP ${response.status}`;
  try {
    const parsed = JSON.parse(text) as { message?: string; detail?: string };
    return parsed.message ?? parsed.detail ?? text;
  } catch {
    return text;
  }
};

const retryDelay = (response: Response, attempt: number): number => {
  const header = response.headers.get('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  return 250 * 2 ** attempt;
};

const compactResponseId = (id: string): string => normalizeNotionObjectId(id) ?? id;

/**
 * Notion API client with durable per-note identities supplied by
 * {@link NotionSyncStoreLike}. Sync creates one page per book hash, batches
 * appends, and archives the previous blocks when a note changes or is deleted.
 */
export class NotionClient {
  constructor(
    private readonly config: NotionSettings,
    private readonly syncStore?: NotionSyncStoreLike,
  ) {}

  private get token(): string {
    return this.config.accessToken.trim();
  }

  /**
   * Web builds go through `/api/notion`, which authenticates the Readest user
   * and only then forwards the Notion secret upstream. So the two credentials
   * travel in separate headers: `Authorization` carries the Readest JWT and
   * `X-Notion-Token` carries the integration secret. Desktop and mobile talk to
   * api.notion.com directly and put the Notion secret in `Authorization`.
   */
  private async proxyHeaders(body?: string): Promise<Record<string, string>> {
    const readestToken = await getAccessToken();
    if (!readestToken) {
      throw new Error('Notion sync requires signing in to Readest on the web');
    }
    return {
      Authorization: `Bearer ${readestToken}`,
      'X-Notion-Token': `Bearer ${this.token}`,
      'Notion-Version': NOTION_API_VERSION,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    };
  }

  private async request(
    path: string,
    options: { method?: RequestMethod; body?: string } = {},
  ): Promise<Response> {
    const { method = 'GET', body } = options;
    const nativeHeaders = {
      Authorization: `Bearer ${this.token}`,
      'Notion-Version': NOTION_API_VERSION,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    };

    for (let attempt = 0; ; attempt += 1) {
      const response = isTauriAppPlatform()
        ? await tauriFetch(`${NOTION_API_BASE_URL}${path}`, {
            method,
            headers: nativeHeaders,
            body,
          })
        : await globalThis.fetch(`/api/notion${path}`, {
            method,
            headers: await this.proxyHeaders(body),
            body,
          });

      const retryable = response.status === 429 || response.status === 529;
      if (!retryable || attempt >= MAX_RATE_LIMIT_RETRIES - 1) return response;
      await response.body?.cancel().catch(() => {});
      await sleep(retryDelay(response, attempt));
    }
  }

  async validateToken(): Promise<{ valid: boolean; isNetworkError?: boolean }> {
    try {
      const response = await this.request('/users/me');
      return { valid: response.status === 200 };
    } catch {
      return { valid: false, isNetworkError: true };
    }
  }

  private dataSourceResult(container: DataSourceContainer): ResolveDataSourceResult {
    const sources = container.data_sources ?? [];
    if (sources.length === 1) {
      return { success: true, dataSourceId: compactResponseId(sources[0]!.id) };
    }
    if (sources.length > 1) {
      return {
        success: false,
        code: 'multiple_data_sources',
        message: 'The Notion database contains multiple data sources',
      };
    }
    return {
      success: false,
      code: 'invalid_target',
      message: 'The Notion database is unavailable or has not been shared',
    };
  }

  /** Resolve a data source id, database-container id, or parent page id. */
  async resolveDataSourceId(inputId: string): Promise<ResolveDataSourceResult> {
    const objectId = normalizeNotionObjectId(inputId) ?? inputId.trim();
    if (!objectId) {
      return { success: false, code: 'invalid_target', message: 'Invalid Notion object id' };
    }

    try {
      const dataSourceResponse = await this.request(`/data_sources/${objectId}`);
      if (dataSourceResponse.ok) {
        const dataSource = (await dataSourceResponse.json()) as { id?: string };
        return { success: true, dataSourceId: compactResponseId(dataSource.id ?? objectId) };
      }
      if (dataSourceResponse.status !== 404) {
        return {
          success: false,
          code: 'invalid_target',
          message: await responseMessage(dataSourceResponse),
        };
      }

      const databaseResponse = await this.request(`/databases/${objectId}`);
      if (databaseResponse.ok) {
        return this.dataSourceResult((await databaseResponse.json()) as DataSourceContainer);
      }
      if (databaseResponse.status !== 404) {
        return {
          success: false,
          code: 'invalid_target',
          message: await responseMessage(databaseResponse),
        };
      }

      let cursor: string | null = null;
      const childDatabaseIds: string[] = [];
      do {
        const query = `?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ''}`;
        const childrenResponse = await this.request(`/blocks/${objectId}/children${query}`);
        if (!childrenResponse.ok) {
          return {
            success: false,
            code: 'invalid_target',
            message: await responseMessage(childrenResponse),
          };
        }
        const children = (await childrenResponse.json()) as BlockChildrenResponse;
        childDatabaseIds.push(
          ...(children.results ?? [])
            .filter((block) => block.type === 'child_database' && !!block.id)
            .map((block) => block.id!),
        );
        cursor = children.has_more ? (children.next_cursor ?? null) : null;
      } while (cursor);

      if (childDatabaseIds.length > 1) {
        return {
          success: false,
          code: 'multiple_data_sources',
          message: 'The page contains multiple child Notion databases',
        };
      }
      const childDatabaseId = childDatabaseIds[0];
      if (childDatabaseId) {
        const childResponse = await this.request(`/databases/${childDatabaseId}`);
        if (!childResponse.ok) {
          return {
            success: false,
            code: 'invalid_target',
            message: await responseMessage(childResponse),
          };
        }
        return this.dataSourceResult((await childResponse.json()) as DataSourceContainer);
      }

      return {
        success: false,
        code: 'invalid_target',
        message: 'The page does not contain a child Notion database',
      };
    } catch (error) {
      return {
        success: false,
        code: 'network_error',
        message: error instanceof Error ? error.message : String(error),
        isNetworkError: true,
      };
    }
  }

  private titleProperty(title: string) {
    return { title: richTextItems(title).slice(0, 100) };
  }

  private bookMarker(bookHash: string): NotionBlock {
    return {
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: richTextItems(
          'Synced from Readest',
          { italic: true, color: 'gray' },
          bookMarkerUrl(bookHash),
        ),
      },
    };
  }

  private async listBlockChildren(blockId: string): Promise<NotionBlock[]> {
    const results: NotionBlock[] = [];
    let cursor: string | null = null;
    do {
      const query = `?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ''}`;
      const response = await this.request(`/blocks/${blockId}/children${query}`);
      if (!response.ok) throw new Error(await responseMessage(response));
      const payload = (await response.json()) as BlockChildrenResponse;
      results.push(...(payload.results ?? []));
      cursor = payload.has_more ? (payload.next_cursor ?? null) : null;
    } while (cursor);
    return results;
  }

  private async findRemoteBookPage(
    targetId: string,
    bookHash: string,
    title: string,
  ): Promise<BookPage | null> {
    let cursor: string | null = null;
    do {
      const response = await this.request(`/data_sources/${targetId}/query`, {
        method: 'POST',
        body: JSON.stringify({
          page_size: 100,
          filter: { property: 'title', title: { equals: title } },
          ...(cursor ? { start_cursor: cursor } : {}),
        }),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      const payload = (await response.json()) as PageQueryResponse;
      for (const page of payload.results ?? []) {
        if (!page.id) continue;
        const children = await this.listBlockChildren(page.id);
        if (children.some((block) => isBookMarker(block, bookHash))) {
          await this.syncStore!.setPageMapping({
            targetId,
            bookHash,
            pageId: page.id,
            title,
          });
          return { pageId: page.id, children, resetMappings: false };
        }
      }
      cursor = payload.has_more ? (payload.next_cursor ?? null) : null;
    } while (cursor);
    return null;
  }

  private async createBookPage(targetId: string, bookHash: string, title: string): Promise<string> {
    const response = await this.request('/pages', {
      method: 'POST',
      body: JSON.stringify({
        parent: { type: 'data_source_id', data_source_id: targetId },
        properties: { title: this.titleProperty(title) },
        children: [this.bookMarker(bookHash)],
      }),
    });
    if (!response.ok) throw new Error(await responseMessage(response));
    const page = (await response.json()) as { id?: string };
    if (!page.id) throw new Error('Notion did not return the created page id');
    await this.syncStore!.setPageMapping({ targetId, bookHash, pageId: page.id, title });
    return page.id;
  }

  private async ensureBookPage(
    targetId: string,
    bookHash: string,
    title: string,
    createIfMissing: boolean,
  ): Promise<BookPage | null> {
    const mapping = await this.syncStore!.getPageMapping(targetId, bookHash);
    if (mapping) {
      const response = await this.request(`/pages/${mapping.pageId}`);
      if (response.ok) {
        const page = (await response.json()) as { archived?: boolean; in_trash?: boolean };
        if (!page.archived && !page.in_trash) {
          if (mapping.title !== title) {
            const update = await this.request(`/pages/${mapping.pageId}`, {
              method: 'PATCH',
              body: JSON.stringify({ properties: { title: this.titleProperty(title) } }),
            });
            if (!update.ok) throw new Error(await responseMessage(update));
            await this.syncStore!.setPageMapping({ ...mapping, title });
          }
          return { pageId: mapping.pageId, resetMappings: false };
        }
      } else if (response.status !== 404) {
        throw new Error(await responseMessage(response));
      }
      await this.syncStore!.clearBookMappings(targetId, bookHash);
    }

    const recovered = await this.findRemoteBookPage(targetId, bookHash, title);
    if (recovered) return { ...recovered, resetMappings: !!mapping };
    if (!createIfMissing) return null;

    if (!mapping) await this.syncStore!.clearBookMappings(targetId, bookHash);
    try {
      return {
        pageId: await this.createBookPage(targetId, bookHash, title),
        resetMappings: true,
      };
    } catch (error) {
      // A transport error can hide a successful Notion write. Rediscover the
      // marker before retrying later so the ambiguous response cannot create a
      // duplicate book page.
      const created = await this.findRemoteBookPage(targetId, bookHash, title);
      if (created) return { ...created, resetMappings: true };
      throw error;
    }
  }

  private async appendBatch(pageId: string, blocks: NotionBlock[]): Promise<string[]> {
    const response = await this.request(`/blocks/${pageId}/children`, {
      method: 'PATCH',
      body: JSON.stringify({ children: blocks }),
    });
    if (!response.ok) throw new Error(await responseMessage(response));
    const payload = (await response.json()) as BlockChildrenResponse;
    const ids = (payload.results ?? [])
      .map((block) => block.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (ids.length !== blocks.length) throw new Error('Notion returned an incomplete block list');
    return ids;
  }

  private async appendPendingNotes(
    pageId: string,
    targetId: string,
    bookHash: string,
    pending: PendingNote[],
  ): Promise<void> {
    let batch: Array<{ block: NotionBlock; noteIndex: number }> = [];

    const flush = async () => {
      if (batch.length === 0) return;
      const ids = await this.appendBatch(
        pageId,
        batch.map((entry) => entry.block),
      );
      const appended = new Map<number, string[]>();
      ids.forEach((id, index) => {
        const noteIndex = batch[index]!.noteIndex;
        const noteIds = appended.get(noteIndex) ?? [];
        noteIds.push(id);
        appended.set(noteIndex, noteIds);
      });
      for (const [noteIndex, noteIds] of appended) {
        const operation = pending[noteIndex]!;
        operation.newBlockIds.push(...noteIds);
        await this.syncStore!.setNoteMapping(
          this.mapping(
            targetId,
            bookHash,
            operation.note.id,
            `pending:${operation.payloadHash}`,
            operation.newBlockIds,
            operation.staleBlockIds,
          ),
        );
      }
      batch = [];
    };

    for (let noteIndex = 0; noteIndex < pending.length; noteIndex += 1) {
      const operation = pending[noteIndex]!;
      for (const block of operation.blocks.slice(operation.newBlockIds.length)) {
        const candidate = [...batch, { block, noteIndex }];
        const candidateBytes = new TextEncoder().encode(
          JSON.stringify({ children: candidate.map((entry) => entry.block) }),
        ).byteLength;
        if (
          batch.length > 0 &&
          (candidate.length > MAX_BLOCKS_PER_REQUEST || candidateBytes > MAX_APPEND_BODY_BYTES)
        ) {
          await flush();
        }
        batch.push({ block, noteIndex });
      }
    }
    await flush();
  }

  private async archiveBlocks(blockIds: string[]): Promise<void> {
    for (const blockId of [...new Set(blockIds)]) {
      const response = await this.request(`/blocks/${blockId}`, { method: 'DELETE' });
      if (!response.ok && response.status !== 404) {
        throw new Error(await responseMessage(response));
      }
    }
  }

  private remoteNoteGroups(
    children: NotionBlock[],
    bookHash: string,
  ): Map<string, RemoteNoteGroup[]> {
    const groups = new Map<string, RemoteNoteGroup[]>();
    for (let index = 0; index < children.length; index += 1) {
      if (children[index]?.type !== 'divider') continue;
      let boundary = index + 1;
      while (boundary < children.length && children[boundary]?.type !== 'divider') boundary += 1;
      let marker: ReturnType<typeof noteMarker> = null;
      for (let candidateIndex = index + 1; candidateIndex < boundary; candidateIndex += 1) {
        marker = noteMarker(children[candidateIndex]!, bookHash);
        if (marker) break;
      }
      if (!marker) continue;

      const selected = children.slice(index, Math.min(index + marker.blockCount, boundary));
      const blockIds = selected
        .map((block) => block.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0);
      const complete = selected.length === marker.blockCount && blockIds.length === selected.length;
      const noteGroups = groups.get(marker.noteId) ?? [];
      noteGroups.push({
        noteId: marker.noteId,
        payloadHash: marker.payloadHash,
        blockIds,
        complete,
      });
      groups.set(marker.noteId, noteGroups);
    }
    return groups;
  }

  private async reconcileRemoteState(
    targetId: string,
    bookHash: string,
    state: NoteState,
    groups: RemoteNoteGroup[],
  ): Promise<NotionNoteMapping | null> {
    const complete = groups.filter((group) => group.complete);
    const matching = complete.filter((group) => group.payloadHash === state.payloadHash);
    if (matching.length > 0) {
      const chosen = matching.at(-1)!;
      const staleBlockIds = groups
        .filter((group) => group !== chosen)
        .flatMap((group) => group.blockIds);
      const recovered = this.mapping(
        targetId,
        bookHash,
        state.note.id,
        state.payloadHash,
        chosen.blockIds,
        staleBlockIds,
      );
      await this.syncStore!.setNoteMapping(recovered);
      await this.archiveBlocks(staleBlockIds);
      const settled = { ...recovered, staleBlockIds: [] };
      await this.syncStore!.setNoteMapping(settled);
      return settled;
    }

    const pendingHash = `pending:${state.payloadHash}`;
    const resumable = groups.find(
      (group) =>
        !group.complete &&
        group.payloadHash === state.payloadHash &&
        state.existing?.payloadHash === pendingHash &&
        group.blockIds.length === state.existing.blockIds.length &&
        group.blockIds.every((id, index) => id === state.existing!.blockIds[index]),
    );
    if (resumable) return state.existing;

    if (complete.length > 0) {
      const chosen = complete.at(-1)!;
      const recovered = this.mapping(
        targetId,
        bookHash,
        state.note.id,
        chosen.payloadHash,
        chosen.blockIds,
        groups.filter((group) => group !== chosen).flatMap((group) => group.blockIds),
      );
      await this.syncStore!.setNoteMapping(recovered);
      return recovered;
    }

    const staleBlockIds = groups.flatMap((group) => group.blockIds);
    if (staleBlockIds.length === 0 && !state.existing) return null;
    const missing = this.mapping(
      targetId,
      bookHash,
      state.note.id,
      'remote-missing',
      [],
      staleBlockIds,
    );
    await this.syncStore!.setNoteMapping(missing);
    return groups.length > 0 || state.existing ? missing : null;
  }

  private mapping(
    targetId: string,
    bookHash: string,
    noteId: string,
    payloadHash: string,
    blockIds: string[],
    staleBlockIds: string[],
  ): NotionNoteMapping {
    return { targetId, bookHash, noteId, payloadHash, blockIds, staleBlockIds };
  }

  async syncBookNotes(
    bookHash: string,
    bookTitle: string,
    notes: BookNote[],
    chapterForNote: (note: BookNote) => string | null,
  ): Promise<SyncResult> {
    const configuredTargetId = this.config.databaseId.trim();
    if (!configuredTargetId) return { success: false, message: 'No Notion data source configured' };
    if (!this.syncStore) return { success: false, message: 'Notion sync state is unavailable' };

    let inserted = 0;
    let updated = 0;
    let deleted = 0;
    let skipped = 0;

    try {
      const resolvedTarget = await this.resolveDataSourceId(configuredTargetId);
      if (!resolvedTarget.success) {
        return {
          success: false,
          message: resolvedTarget.message,
          isNetworkError: resolvedTarget.isNetworkError,
        };
      }
      const targetId = resolvedTarget.dataSourceId;
      const eligible = notes.filter(
        (note) => note.type === 'annotation' || note.type === 'excerpt',
      );
      if (eligible.length === 0) {
        return { success: true, inserted, updated, deleted, skipped };
      }

      const template =
        this.config.useCustomTemplate && this.config.customTemplate
          ? { source: this.config.customTemplate, bookHash, title: bookTitle }
          : undefined;
      const states: NoteState[] = [];
      for (const note of eligible) {
        const isDeleted = !!note.deletedAt || !note.text;
        let payloadHash: string;
        let blocks: NotionBlock[];
        if (isDeleted) {
          payloadHash = getContentMd5({ deleted: true });
          blocks = [];
        } else {
          const chapter = chapterForNote(note);
          const unmarkedBlocks = buildNoteBlocks(
            note,
            chapter,
            this.config.includeChapterHeading ?? true,
            undefined,
            template,
          );
          payloadHash = getContentMd5({
            text: note.text,
            note: note.note,
            color: quoteColor(note),
            chapter,
            createdAt: note.createdAt,
            includeChapterHeading: this.config.includeChapterHeading ?? true,
            // Only templated notes hash their rendered blocks, so turning the
            // template on, or editing it, rewrites them; without one the hash
            // stays as before.
            blocks: template ? unmarkedBlocks : undefined,
          });
          blocks = buildNoteBlocks(
            note,
            chapter,
            this.config.includeChapterHeading ?? true,
            noteMarkerUrl(bookHash, note, payloadHash, unmarkedBlocks.length),
            template,
          );
        }
        states.push({
          note,
          isDeleted,
          payloadHash,
          blocks,
          existing: await this.syncStore.getNoteMapping(targetId, bookHash, note.id),
        });
      }

      const pageMapping = await this.syncStore.getPageMapping(targetId, bookHash);
      const hasActiveNotes = states.some((state) => !state.isDeleted);
      const needsRemoteState = states.some(
        (state) =>
          !state.existing ||
          (state.existing.payloadHash.startsWith('pending:') &&
            state.existing.blockIds.length === 0),
      );
      const needsActiveWrite = states.some(
        (state) =>
          !state.isDeleted && (!state.existing || state.existing.payloadHash !== state.payloadHash),
      );
      const needsPage =
        hasActiveNotes && (needsActiveWrite || !pageMapping || pageMapping.title !== bookTitle);
      const bookPage =
        needsPage || (!hasActiveNotes && needsRemoteState)
          ? await this.ensureBookPage(targetId, bookHash, bookTitle, hasActiveNotes)
          : null;

      if (bookPage?.resetMappings) {
        for (const state of states) state.existing = null;
      }

      const shouldScanRemote =
        !!bookPage &&
        (bookPage.children !== undefined || !bookPage.resetMappings) &&
        (needsRemoteState || !pageMapping || bookPage.resetMappings);
      if (shouldScanRemote) {
        const children = bookPage.children ?? (await this.listBlockChildren(bookPage.pageId));
        const remoteGroups = this.remoteNoteGroups(children, bookHash);
        for (const state of states) {
          if (
            !pageMapping ||
            bookPage.resetMappings ||
            !state.existing ||
            (state.existing.payloadHash.startsWith('pending:') &&
              state.existing.blockIds.length === 0)
          ) {
            state.existing = await this.reconcileRemoteState(
              targetId,
              bookHash,
              state,
              remoteGroups.get(state.note.id) ?? [],
            );
          }
        }
      }

      const pending: PendingNote[] = [];

      for (const state of states) {
        const { note, isDeleted, blocks, payloadHash, existing } = state;

        if (existing?.payloadHash === payloadHash) {
          if (existing.staleBlockIds.length > 0) {
            await this.archiveBlocks(existing.staleBlockIds);
            await this.syncStore.setNoteMapping({ ...existing, staleBlockIds: [] });
          }
          skipped += 1;
          continue;
        }

        if (isDeleted) {
          if (!existing) {
            skipped += 1;
            continue;
          }
          const staleBlockIds = [...existing.blockIds, ...existing.staleBlockIds];
          const next = this.mapping(targetId, bookHash, note.id, payloadHash, [], staleBlockIds);
          await this.syncStore.setNoteMapping(next);
          await this.archiveBlocks(staleBlockIds);
          await this.syncStore.setNoteMapping({ ...next, staleBlockIds: [] });
          deleted += 1;
          continue;
        }

        const pendingHash = `pending:${payloadHash}`;
        const isResuming = existing?.payloadHash === pendingHash;
        const operation: PendingNote = {
          note,
          payloadHash,
          blocks,
          newBlockIds: isResuming ? existing.blockIds : [],
          staleBlockIds: isResuming
            ? existing.staleBlockIds
            : [...(existing?.blockIds ?? []), ...(existing?.staleBlockIds ?? [])],
        };
        if (!isResuming) {
          await this.syncStore.setNoteMapping(
            this.mapping(
              targetId,
              bookHash,
              note.id,
              pendingHash,
              operation.newBlockIds,
              operation.staleBlockIds,
            ),
          );
        }
        pending.push(operation);
      }

      if (pending.length > 0) {
        if (!bookPage) throw new Error('Notion book page is unavailable');
        await this.appendPendingNotes(bookPage.pageId, targetId, bookHash, pending);
        for (const operation of pending) {
          const next = this.mapping(
            targetId,
            bookHash,
            operation.note.id,
            operation.payloadHash,
            operation.newBlockIds,
            operation.staleBlockIds,
          );
          await this.syncStore.setNoteMapping(next);
          await this.archiveBlocks(operation.staleBlockIds);
          await this.syncStore.setNoteMapping({ ...next, staleBlockIds: [] });
          if (operation.staleBlockIds.length > 0) updated += 1;
          else inserted += 1;
        }
      }

      return { success: true, inserted, updated, deleted, skipped };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
        isNetworkError: error instanceof TypeError,
      };
    }
  }
}

function formatNotionDate(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
