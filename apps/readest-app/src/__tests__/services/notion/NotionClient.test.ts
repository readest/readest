import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { NOTION_API_BASE_URL, NOTION_API_VERSION } from '@/services/constants';
import { isTauriAppPlatform } from '@/services/environment';
import { getAccessToken } from '@/utils/access';
import {
  DEFAULT_NOTION_NOTE_TEMPLATE,
  normalizeNotionObjectId,
  NotionClient,
  type NotionSyncStoreLike,
} from '@/services/notion/NotionClient';
import type { BookNote } from '@/types/book';
import type { NotionSettings } from '@/types/settings';
import { buildAnnotationAppUrl, buildAnnotationWebUrl } from '@/utils/deeplink';

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: vi.fn(() => false) }));
vi.mock('@/utils/access', () => ({ getAccessToken: vi.fn(async () => 'readest-jwt') }));

const TARGET_ID = '1234567890abcdef1234567890abcdef';
const PAGE_ID = 'page-id';

const makeSettings = (): NotionSettings => ({
  enabled: true,
  accessToken: 'secret_test',
  databaseId: TARGET_ID,
  lastSyncedAt: 0,
  includeChapterHeading: true,
});

const makeNote = (overrides: Partial<BookNote> = {}): BookNote =>
  ({
    id: 'note-1',
    type: 'annotation',
    cfi: 'epubcfi(/6/2!/4)',
    text: 'Highlighted text',
    note: 'My note',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  }) as BookNote;

type PageMapping = Awaited<ReturnType<NotionSyncStoreLike['getPageMapping']>>;
type NoteMapping = Awaited<ReturnType<NotionSyncStoreLike['getNoteMapping']>>;

const makeStore = () => {
  const pages = new Map<string, NonNullable<PageMapping>>();
  const notes = new Map<string, NonNullable<NoteMapping>>();
  const writes: NonNullable<NoteMapping>[] = [];
  const store: NotionSyncStoreLike = {
    getPageMapping: vi.fn(
      async (targetId, bookHash) => pages.get(`${targetId}:${bookHash}`) ?? null,
    ),
    setPageMapping: vi.fn(async (mapping) => {
      pages.set(`${mapping.targetId}:${mapping.bookHash}`, mapping);
    }),
    clearBookMappings: vi.fn(async (targetId, bookHash) => {
      pages.delete(`${targetId}:${bookHash}`);
      for (const key of notes.keys()) {
        if (key.startsWith(`${targetId}:${bookHash}:`)) notes.delete(key);
      }
    }),
    getNoteMapping: vi.fn(
      async (targetId, bookHash, noteId) => notes.get(`${targetId}:${bookHash}:${noteId}`) ?? null,
    ),
    setNoteMapping: vi.fn(async (mapping) => {
      writes.push({ ...mapping });
      notes.set(`${mapping.targetId}:${mapping.bookHash}:${mapping.noteId}`, mapping);
    }),
  };
  return { store, pages, notes, writes };
};

const jsonResponse = (body: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

describe('normalizeNotionObjectId', () => {
  test('accepts UUIDs and Notion URLs but rejects arbitrary input', () => {
    expect(normalizeNotionObjectId('12345678-90ab-cdef-1234-567890abcdef')).toBe(TARGET_ID);
    expect(
      normalizeNotionObjectId(
        'https://www.notion.so/workspace/My-Database-1234567890abcdef1234567890abcdef?v=abc',
      ),
    ).toBe(TARGET_ID);
    expect(normalizeNotionObjectId('not-a-database')).toBeNull();
  });
});

describe('NotionClient transport credentials', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  test('web builds send the Readest JWT as auth and the Notion secret separately', async () => {
    vi.mocked(isTauriAppPlatform).mockReturnValue(false);

    await new NotionClient(makeSettings()).validateToken();

    const [url, init] = fetchMock.mock.calls[0]!;
    const headers = init.headers as Record<string, string>;
    expect(url).toBe('/api/notion/users/me');
    // The proxy authenticates the caller, so the Notion secret must not be the
    // thing in `Authorization` on this path.
    expect(headers['Authorization']).toBe('Bearer readest-jwt');
    expect(headers['X-Notion-Token']).toBe('Bearer secret_test');
  });

  test('web builds refuse to sync when the user is not signed in to Readest', async () => {
    vi.mocked(isTauriAppPlatform).mockReturnValue(false);
    vi.mocked(getAccessToken).mockResolvedValueOnce(null);

    const result = await new NotionClient(makeSettings()).validateToken();

    expect(result).toEqual({ valid: false, isNetworkError: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('native builds call Notion directly with the secret and no proxy header', async () => {
    vi.mocked(isTauriAppPlatform).mockReturnValue(true);
    vi.mocked(tauriFetch).mockResolvedValue(jsonResponse({}) as never);

    await new NotionClient(makeSettings()).validateToken();

    const [url, init] = vi.mocked(tauriFetch).mock.calls[0]!;
    const headers = (init as { headers: Record<string, string> }).headers;
    expect(url).toBe(`${NOTION_API_BASE_URL}/users/me`);
    expect(headers['Authorization']).toBe('Bearer secret_test');
    expect(headers['X-Notion-Token']).toBeUndefined();
    expect(getAccessToken).not.toHaveBeenCalled();
  });
});

describe('NotionClient target resolution', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(isTauriAppPlatform).mockReturnValue(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  test('resolves a database container to its single current data source', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: 'not a data source' }, 404))
      .mockResolvedValueOnce(
        jsonResponse({ data_sources: [{ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }] }),
      );

    const result = await new NotionClient(makeSettings()).resolveDataSourceId(TARGET_ID);

    expect(result).toEqual({
      success: true,
      dataSourceId: 'aaaaaaaabbbbccccddddeeeeeeeeeeee',
    });
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      `/api/notion/data_sources/${TARGET_ID}`,
      `/api/notion/databases/${TARGET_ID}`,
    ]);
  });

  test('paginates a parent page until it finds and resolves a child database', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: 'not a data source' }, 404))
      .mockResolvedValueOnce(jsonResponse({ message: 'not a database' }, 404))
      .mockResolvedValueOnce(
        jsonResponse({ results: [], has_more: true, next_cursor: 'cursor with spaces' }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          results: [{ id: 'child-db', type: 'child_database' }],
          has_more: false,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ data_sources: [{ id: 'ffffffff-aaaa-bbbb-cccc-dddddddddddd' }] }),
      );

    const result = await new NotionClient(makeSettings()).resolveDataSourceId(TARGET_ID);

    expect(result).toEqual({
      success: true,
      dataSourceId: 'ffffffffaaaabbbbccccdddddddddddd',
    });
    expect(fetchMock.mock.calls[3]![0]).toBe(
      `/api/notion/blocks/${TARGET_ID}/children?page_size=100&start_cursor=cursor%20with%20spaces`,
    );
    expect(fetchMock.mock.calls[4]![0]).toBe('/api/notion/databases/child-db');
  });

  test('rejects an ambiguous multi-source database', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: 'not a data source' }, 404))
      .mockResolvedValueOnce(jsonResponse({ data_sources: [{ id: 'one' }, { id: 'two' }] }));

    const result = await new NotionClient(makeSettings()).resolveDataSourceId(TARGET_ID);

    expect(result).toEqual(
      expect.objectContaining({ success: false, code: 'multiple_data_sources' }),
    );
  });

  test('rejects a parent page with multiple child databases', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: 'not a data source' }, 404))
      .mockResolvedValueOnce(jsonResponse({ message: 'not a database' }, 404))
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            { id: 'child-a', type: 'child_database' },
            { id: 'child-b', type: 'child_database' },
          ],
          has_more: false,
        }),
      );

    const result = await new NotionClient(makeSettings()).resolveDataSourceId(TARGET_ID);

    expect(result).toEqual(
      expect.objectContaining({ success: false, code: 'multiple_data_sources' }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('NotionClient note sync', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(tauriFetch).mockReset();
    vi.mocked(isTauriAppPlatform).mockReturnValue(false);
    vi.spyOn(NotionClient.prototype, 'resolveDataSourceId').mockResolvedValue({
      success: true,
      dataSourceId: TARGET_ID,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test('resolves legacy database ids before syncing and stores the current data source id', async () => {
    const dataSourceId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    vi.mocked(NotionClient.prototype.resolveDataSourceId).mockResolvedValueOnce({
      success: true,
      dataSourceId,
    });
    const { store, pages } = makeStore();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [], has_more: false }))
      .mockResolvedValueOnce(jsonResponse({ id: PAGE_ID }))
      .mockResolvedValueOnce(
        jsonResponse({ results: Array.from({ length: 5 }, (_, i) => ({ id: `block-${i}` })) }),
      );

    const result = await new NotionClient(makeSettings(), store).syncBookNotes(
      'book-hash',
      'Book',
      [makeNote()],
      () => 'Chapter',
    );

    expect(result.success).toBe(true);
    expect(NotionClient.prototype.resolveDataSourceId).toHaveBeenCalledWith(TARGET_ID);
    expect(pages.get(`${dataSourceId}:book-hash`)?.pageId).toBe(PAGE_ID);
    const createBody = JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string);
    expect(createBody.parent.data_source_id).toBe(dataSourceId);
  });

  test('recovers remote book and note identities on a fresh device without duplicating content', async () => {
    const firstStore = makeStore();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [], has_more: false }))
      .mockResolvedValueOnce(jsonResponse({ id: PAGE_ID }))
      .mockResolvedValueOnce(
        jsonResponse({ results: Array.from({ length: 5 }, (_, i) => ({ id: `block-${i}` })) }),
      );
    const first = await new NotionClient(makeSettings(), firstStore.store).syncBookNotes(
      'book-hash',
      'Book',
      [makeNote()],
      () => 'Chapter',
    );
    expect(first.success).toBe(true);

    const createBody = JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string);
    const appendBody = JSON.parse((fetchMock.mock.calls[2]![1] as RequestInit).body as string);
    const remoteChildren = [
      { ...createBody.children[0], id: 'book-marker' },
      ...appendBody.children.map((block: Record<string, unknown>, index: number) => ({
        ...block,
        id: `block-${index}`,
      })),
    ];

    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [{ id: PAGE_ID }], has_more: false }))
      .mockResolvedValueOnce(jsonResponse({ results: remoteChildren, has_more: false }));
    const freshStore = makeStore();
    const recovered = await new NotionClient(makeSettings(), freshStore.store).syncBookNotes(
      'book-hash',
      'Book',
      [makeNote()],
      () => 'Chapter',
    );

    expect(recovered).toEqual({
      success: true,
      inserted: 0,
      updated: 0,
      deleted: 0,
      skipped: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(freshStore.pages.get(`${TARGET_ID}:book-hash`)?.pageId).toBe(PAGE_ID);
    expect(freshStore.notes.get(`${TARGET_ID}:book-hash:note-1`)?.blockIds).toEqual([
      'block-0',
      'block-1',
      'block-2',
      'block-3',
      'block-4',
    ]);

    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [{ id: PAGE_ID }], has_more: false }))
      .mockResolvedValueOnce(jsonResponse({ results: remoteChildren, has_more: false }));
    for (let index = 0; index < 5; index += 1) {
      fetchMock.mockResolvedValueOnce(jsonResponse({ id: `block-${index}`, archived: true }));
    }
    const deleted = await new NotionClient(makeSettings(), makeStore().store).syncBookNotes(
      'book-hash',
      'Book',
      [makeNote({ deletedAt: 1_800_000_000_000 })],
      () => 'Chapter',
    );
    expect(deleted).toEqual({
      success: true,
      inserted: 0,
      updated: 0,
      deleted: 1,
      skipped: 0,
    });
    expect(
      fetchMock.mock.calls.filter(
        ([, init]) => (init as RequestInit | undefined)?.method === 'DELETE',
      ),
    ).toHaveLength(5);
  });

  test('links the book and note markers to pages that open in Readest', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [], has_more: false }))
      .mockResolvedValueOnce(jsonResponse({ id: PAGE_ID }))
      .mockResolvedValueOnce(
        jsonResponse({ results: Array.from({ length: 5 }, (_, i) => ({ id: `block-${i}` })) }),
      );

    await new NotionClient(makeSettings(), makeStore().store).syncBookNotes(
      'book-hash',
      'Book',
      [makeNote()],
      () => 'Chapter',
    );

    const createBody = JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string);
    const appendBody = JSON.parse((fetchMock.mock.calls[2]![1] as RequestInit).body as string);
    expect(createBody.children[0].paragraph.rich_text[0].text.link.url).toBe(
      'https://web.readest.com/reader/book-hash',
    );
    const noteLink = appendBody.children[1].paragraph.rich_text[0].text.link.url as string;
    expect(noteLink).toMatch(
      new RegExp(
        `^${buildAnnotationWebUrl({
          bookHash: 'book-hash',
          noteId: 'note-1',
          cfi: 'epubcfi(/6/2!/4)',
        }).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}&notion=[0-9a-f]{32}\\.5$`,
      ),
    );
  });

  test('recovers pages and notes whose markers were written by an earlier release', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [], has_more: false }))
      .mockResolvedValueOnce(jsonResponse({ id: PAGE_ID }))
      .mockResolvedValueOnce(
        jsonResponse({ results: Array.from({ length: 5 }, (_, i) => ({ id: `block-${i}` })) }),
      );
    await new NotionClient(makeSettings(), makeStore().store).syncBookNotes(
      'book-hash',
      'Book',
      [makeNote()],
      () => 'Chapter',
    );
    const createBody = JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string);
    const appendBody = JSON.parse((fetchMock.mock.calls[2]![1] as RequestInit).body as string);
    type LinkedParagraph = { paragraph: { rich_text: { text: { link: { url: string } } }[] } };
    const withLink = (block: LinkedParagraph, url: string) => {
      const copy = structuredClone(block);
      copy.paragraph.rich_text[0]!.text.link.url = url;
      return copy;
    };
    const noteLink = new URL(appendBody.children[1].paragraph.rich_text[0].text.link.url);
    const [payloadHash, blockCount] = noteLink.searchParams.get('notion')!.split('.');
    const remoteChildren = [
      withLink(createBody.children[0], 'https://readest.com/notion-sync/book/book-hash'),
      appendBody.children[0],
      withLink(
        appendBody.children[1],
        `https://readest.com/notion-sync/note/book-hash/note-1/${payloadHash}/${blockCount}`,
      ),
      ...appendBody.children.slice(2),
    ].map((block, index) => ({ ...block, id: `block-${index}` }));

    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [{ id: PAGE_ID }], has_more: false }))
      .mockResolvedValueOnce(jsonResponse({ results: remoteChildren, has_more: false }));
    const freshStore = makeStore();
    const recovered = await new NotionClient(makeSettings(), freshStore.store).syncBookNotes(
      'book-hash',
      'Book',
      [makeNote()],
      () => 'Chapter',
    );

    expect(recovered).toEqual({ success: true, inserted: 0, updated: 0, deleted: 0, skipped: 1 });
    expect(freshStore.notes.get(`${TARGET_ID}:book-hash:note-1`)?.blockIds).toEqual([
      'block-1',
      'block-2',
      'block-3',
      'block-4',
      'block-5',
    ]);
  });

  test('recovers an append whose successful upstream response was lost', async () => {
    const { store } = makeStore();
    let committedChildren: Array<Record<string, unknown>> = [];
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [], has_more: false }))
      .mockResolvedValueOnce(jsonResponse({ id: PAGE_ID }))
      .mockImplementationOnce(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(init?.body as string);
        committedChildren = body.children.map((block: Record<string, unknown>, index: number) => ({
          ...block,
          id: `committed-${index}`,
        }));
        throw new TypeError('connection closed after commit');
      });
    const client = new NotionClient(makeSettings(), store);

    const interrupted = await client.syncBookNotes(
      'book-hash',
      'Book',
      [makeNote()],
      () => 'Chapter',
    );
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: PAGE_ID })).mockResolvedValueOnce(
      jsonResponse({
        results: [
          {
            id: 'book-marker',
            object: 'block',
            type: 'paragraph',
            paragraph: { rich_text: [] },
          },
          ...committedChildren,
        ],
        has_more: false,
      }),
    );
    const recovered = await client.syncBookNotes(
      'book-hash',
      'Book',
      [makeNote()],
      () => 'Chapter',
    );

    expect(interrupted).toEqual(expect.objectContaining({ success: false, isNetworkError: true }));
    expect(recovered).toEqual({
      success: true,
      inserted: 0,
      updated: 0,
      deleted: 0,
      skipped: 1,
    });
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) =>
          url === `/api/notion/blocks/${PAGE_ID}/children` &&
          (init as RequestInit).method === 'PATCH',
      ),
    ).toHaveLength(1);
  });

  test('recovers a created page whose successful upstream response was lost', async () => {
    const { store, pages } = makeStore();
    let bookMarker: Record<string, unknown> | undefined;
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [], has_more: false }))
      .mockImplementationOnce(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(init?.body as string);
        bookMarker = { ...body.children[0], id: 'book-marker' };
        throw new TypeError('connection closed after page creation');
      })
      .mockResolvedValueOnce(jsonResponse({ results: [{ id: PAGE_ID }], has_more: false }))
      .mockImplementationOnce(async () => jsonResponse({ results: [bookMarker], has_more: false }))
      .mockResolvedValueOnce(
        jsonResponse({ results: Array.from({ length: 5 }, (_, i) => ({ id: `block-${i}` })) }),
      );

    const result = await new NotionClient(makeSettings(), store).syncBookNotes(
      'book-hash',
      'Book',
      [makeNote()],
      () => 'Chapter',
    );

    expect(result.success).toBe(true);
    expect(pages.get(`${TARGET_ID}:book-hash`)?.pageId).toBe(PAGE_ID);
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/notion/pages')).toHaveLength(1);
  });

  test('recreates a trashed mapped page and clears stale local identities', async () => {
    const { store, pages, notes } = makeStore();
    pages.set(`${TARGET_ID}:book-hash`, {
      targetId: TARGET_ID,
      bookHash: 'book-hash',
      pageId: 'trashed-page',
      title: 'Book',
    });
    notes.set(`${TARGET_ID}:book-hash:note-1`, {
      targetId: TARGET_ID,
      bookHash: 'book-hash',
      noteId: 'note-1',
      payloadHash: 'old-hash',
      blockIds: ['old-block'],
      staleBlockIds: [],
    });
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 'trashed-page', in_trash: true }))
      .mockResolvedValueOnce(jsonResponse({ results: [], has_more: false }))
      .mockResolvedValueOnce(jsonResponse({ id: 'replacement-page' }))
      .mockResolvedValueOnce(
        jsonResponse({ results: Array.from({ length: 5 }, (_, i) => ({ id: `new-${i}` })) }),
      );

    const result = await new NotionClient(makeSettings(), store).syncBookNotes(
      'book-hash',
      'Book',
      [makeNote({ updatedAt: 1_800_000_000_000 })],
      () => 'Chapter',
    );

    expect(result).toEqual({ success: true, inserted: 1, updated: 0, deleted: 0, skipped: 0 });
    expect(store.clearBookMappings).toHaveBeenCalledWith(TARGET_ID, 'book-hash');
    expect(pages.get(`${TARGET_ID}:book-hash`)?.pageId).toBe('replacement-page');
  });

  test('creates distinct pages for different book hashes that share a title', async () => {
    const { store, pages } = makeStore();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [], has_more: false }))
      .mockResolvedValueOnce(jsonResponse({ id: 'page-a' }))
      .mockResolvedValueOnce(
        jsonResponse({ results: Array.from({ length: 5 }, (_, i) => ({ id: `a-${i}` })) }),
      )
      .mockResolvedValueOnce(jsonResponse({ results: [], has_more: false }))
      .mockResolvedValueOnce(jsonResponse({ id: 'page-b' }))
      .mockResolvedValueOnce(
        jsonResponse({ results: Array.from({ length: 5 }, (_, i) => ({ id: `b-${i}` })) }),
      );
    const client = new NotionClient(makeSettings(), store);

    await client.syncBookNotes('book-a', 'Same Title', [makeNote()], () => 'Chapter');
    await client.syncBookNotes('book-b', 'Same Title', [makeNote()], () => 'Chapter');

    expect(pages.get(`${TARGET_ID}:book-a`)?.pageId).toBe('page-a');
    expect(pages.get(`${TARGET_ID}:book-b`)?.pageId).toBe('page-b');
    expect(fetchMock.mock.calls.filter((call) => call[0] === '/api/notion/pages')).toHaveLength(2);
  });

  test('updates the mapped page title when a book is renamed', async () => {
    const { store, pages } = makeStore();
    pages.set(`${TARGET_ID}:book-hash`, {
      targetId: TARGET_ID,
      bookHash: 'book-hash',
      pageId: PAGE_ID,
      title: 'Old Title',
    });
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: PAGE_ID }))
      .mockResolvedValueOnce(jsonResponse({ id: PAGE_ID }))
      .mockResolvedValueOnce(jsonResponse({ results: [], has_more: false }))
      .mockResolvedValueOnce(
        jsonResponse({ results: Array.from({ length: 5 }, (_, i) => ({ id: `block-${i}` })) }),
      );

    const result = await new NotionClient(makeSettings(), store).syncBookNotes(
      'book-hash',
      'New Title',
      [makeNote()],
      () => 'Chapter',
    );

    expect(result.success).toBe(true);
    expect(fetchMock.mock.calls[1]![0]).toBe(`/api/notion/pages/${PAGE_ID}`);
    expect((fetchMock.mock.calls[1]![1] as RequestInit).method).toBe('PATCH');
    expect(pages.get(`${TARGET_ID}:book-hash`)?.title).toBe('New Title');
  });

  test('batches notes, persists their block ids, and skips an unchanged repeat', async () => {
    const { store } = makeStore();
    const notes = [makeNote(), makeNote({ id: 'note-2', cfi: 'epubcfi(/6/4!/4)' })];
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [], has_more: false }))
      .mockResolvedValueOnce(jsonResponse({ id: PAGE_ID }))
      .mockResolvedValueOnce(
        jsonResponse({ results: Array.from({ length: 10 }, (_, i) => ({ id: `block-${i}` })) }),
      );
    const client = new NotionClient(makeSettings(), store);

    const first = await client.syncBookNotes('book-hash', 'Same Title', notes, () => 'Chapter');
    const second = await client.syncBookNotes('book-hash', 'Same Title', notes, () => 'Chapter');

    expect(first).toEqual({ success: true, inserted: 2, updated: 0, deleted: 0, skipped: 0 });
    expect(second).toEqual({ success: true, inserted: 0, updated: 0, deleted: 0, skipped: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/notion/pages');
    const createBody = JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string);
    expect(createBody.parent).toEqual({ type: 'data_source_id', data_source_id: TARGET_ID });
    expect(createBody.children).toHaveLength(1);
    expect(fetchMock.mock.calls[2]![0]).toBe(`/api/notion/blocks/${PAGE_ID}/children`);
    const appendBody = JSON.parse((fetchMock.mock.calls[2]![1] as RequestInit).body as string);
    expect(appendBody.children).toHaveLength(10);
  });

  test('colours each quote with its highlight colour and writes the note as a callout', async () => {
    const { store } = makeStore();
    const notes = [
      makeNote({ color: 'violet' }),
      makeNote({ id: 'note-2', color: '#123456', note: '' }),
    ];
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [], has_more: false }))
      .mockResolvedValueOnce(jsonResponse({ id: PAGE_ID }))
      .mockResolvedValueOnce(
        jsonResponse({ results: Array.from({ length: 9 }, (_, i) => ({ id: `block-${i}` })) }),
      );

    await new NotionClient(makeSettings(), store).syncBookNotes(
      'book-hash',
      'Book',
      notes,
      () => 'Chapter',
    );

    const appendBody = JSON.parse((fetchMock.mock.calls[2]![1] as RequestInit).body as string);
    const quotes = appendBody.children.filter((block: { type: string }) => block.type === 'quote');
    expect(quotes.map((block: { quote: { color: string } }) => block.quote.color)).toEqual([
      'purple_background',
      'default',
    ]);
    const callouts = appendBody.children.filter(
      (block: { type: string }) => block.type === 'callout',
    );
    expect(callouts).toHaveLength(1);
    expect(callouts[0].callout.rich_text[0].text.content).toBe('My note');
    expect(callouts[0].callout.icon).toEqual({ type: 'emoji', emoji: '📝' });
  });

  test('renders each note through a custom Markdown template', async () => {
    const { store } = makeStore();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [], has_more: false }))
      .mockResolvedValueOnce(jsonResponse({ id: PAGE_ID }))
      .mockResolvedValueOnce(
        jsonResponse({ results: Array.from({ length: 7 }, (_, i) => ({ id: `block-${i}` })) }),
      );
    const settings = {
      ...makeSettings(),
      useCustomTemplate: true,
      customTemplate: [
        '## {{ chapter.title }} · {{ title }}',
        '',
        '> {{ annotation.text }}',
        '',
        '---',
        '',
        '> [!TIP]',
        '> **Note:** {{ annotation.note }}',
        '',
        '- page {{ annotation.page }}',
        '- [source](https://example.com)',
      ].join('\n'),
    };

    await new NotionClient(settings, store).syncBookNotes(
      'book-hash',
      'Book',
      [makeNote({ color: 'green', page: 12 })],
      () => 'Chapter',
    );

    const { children } = JSON.parse((fetchMock.mock.calls[2]![1] as RequestInit).body as string);
    expect(children.map((block: { type: string }) => block.type)).toEqual([
      'divider',
      'paragraph',
      'heading_2',
      'quote',
      'callout',
      'bulleted_list_item',
      'bulleted_list_item',
    ]);
    expect(children[2].heading_2.rich_text[0].text.content).toBe('Chapter · Book');
    expect(children[3].quote.color).toBe('green_background');
    expect(children[3].quote.rich_text[0].text.content).toBe('Highlighted text');
    expect(children[4].callout.icon).toEqual({ type: 'emoji', emoji: '💡' });
    expect(children[4].callout.rich_text).toEqual([
      expect.objectContaining({ text: { content: 'Note:' }, annotations: { bold: true } }),
      expect.objectContaining({ text: { content: ' My note' } }),
    ]);
    expect(children[5].bulleted_list_item.rich_text[0].text.content).toBe('page 12');
    expect(children[6].bulleted_list_item.rich_text[0].text).toEqual({
      content: 'source',
      link: { url: 'https://example.com' },
    });
  });

  test('the default template renders the built-in layout', async () => {
    const appended = async (settings: NotionSettings) => {
      fetchMock.mockReset();
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ results: [], has_more: false }))
        .mockResolvedValueOnce(jsonResponse({ id: PAGE_ID }))
        .mockResolvedValueOnce(
          jsonResponse({ results: Array.from({ length: 5 }, (_, i) => ({ id: `block-${i}` })) }),
        );
      await new NotionClient(settings, makeStore().store).syncBookNotes(
        'book-hash',
        'Book',
        [
          makeNote({
            color: 'blue',
            text: 'First paragraph\n\n# Not a heading, __init__ *b* [c](https://d.e) 1. x',
            note: 'Note one\n\nNote **two**',
          }),
        ],
        () => 'Chapter *1*',
      );
      const { children } = JSON.parse((fetchMock.mock.calls[2]![1] as RequestInit).body as string);
      return children.slice(2);
    };

    expect(
      await appended({
        ...makeSettings(),
        useCustomTemplate: true,
        customTemplate: DEFAULT_NOTION_NOTE_TEMPLATE,
      }),
    ).toEqual(await appended(makeSettings()));
  });

  test('gives the template the annotation web link as its link', async () => {
    const { store } = makeStore();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [], has_more: false }))
      .mockResolvedValueOnce(jsonResponse({ id: PAGE_ID }))
      .mockResolvedValueOnce(
        jsonResponse({ results: Array.from({ length: 4 }, (_, i) => ({ id: `block-${i}` })) }),
      );
    const settings = {
      ...makeSettings(),
      useCustomTemplate: true,
      customTemplate: '[Open]({{ annotation.link }})\n\n{{ annotation.appLink }}',
    };

    await new NotionClient(settings, store).syncBookNotes(
      'book-hash',
      'Book',
      [makeNote()],
      () => null,
    );

    const { children } = JSON.parse((fetchMock.mock.calls[2]![1] as RequestInit).body as string);
    const link = { bookHash: 'book-hash', noteId: 'note-1', cfi: 'epubcfi(/6/2!/4)' };
    expect(children[2].paragraph.rich_text[0].text.link).toEqual({
      url: buildAnnotationWebUrl(link),
    });
    expect(children[3].paragraph.rich_text[0].text.content).toBe(buildAnnotationAppUrl(link));
  });

  test('rewrites synced notes when the custom template changes', async () => {
    const { store } = makeStore();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [], has_more: false }))
      .mockResolvedValueOnce(jsonResponse({ id: PAGE_ID }))
      .mockResolvedValueOnce(
        jsonResponse({ results: Array.from({ length: 5 }, (_, i) => ({ id: `block-${i}` })) }),
      )
      .mockResolvedValueOnce(jsonResponse({ id: PAGE_ID }))
      .mockResolvedValueOnce(
        jsonResponse({ results: Array.from({ length: 3 }, (_, i) => ({ id: `new-${i}` })) }),
      )
      .mockResolvedValue(jsonResponse({ archived: true }));

    await new NotionClient(makeSettings(), store).syncBookNotes(
      'book-hash',
      'Book',
      [makeNote()],
      () => 'Chapter',
    );
    const templated = await new NotionClient(
      { ...makeSettings(), useCustomTemplate: true, customTemplate: '> {{ annotation.text }}' },
      store,
    ).syncBookNotes('book-hash', 'Book', [makeNote()], () => 'Chapter');

    expect(templated).toEqual({ success: true, inserted: 0, updated: 1, deleted: 0, skipped: 0 });
  });

  test('rewrites a synced note when its highlight colour changes', async () => {
    const { store } = makeStore();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [], has_more: false }))
      .mockResolvedValueOnce(jsonResponse({ id: PAGE_ID }))
      .mockResolvedValueOnce(
        jsonResponse({ results: Array.from({ length: 4 }, (_, i) => ({ id: `block-${i}` })) }),
      )
      .mockResolvedValueOnce(jsonResponse({ id: PAGE_ID }))
      .mockResolvedValueOnce(
        jsonResponse({ results: Array.from({ length: 4 }, (_, i) => ({ id: `new-${i}` })) }),
      )
      .mockResolvedValue(jsonResponse({ archived: true }));
    const client = new NotionClient(makeSettings(), store);

    await client.syncBookNotes('book-hash', 'Book', [makeNote({ color: 'yellow' })], () => null);
    const recoloured = await client.syncBookNotes(
      'book-hash',
      'Book',
      [makeNote({ color: 'green' })],
      () => null,
    );

    expect(recoloured).toEqual({ success: true, inserted: 0, updated: 1, deleted: 0, skipped: 0 });
  });

  test('records replacement blocks before deleting stale blocks so a retry cannot append twice', async () => {
    const { store, pages, notes, writes } = makeStore();
    pages.set(`${TARGET_ID}:book-hash`, {
      targetId: TARGET_ID,
      bookHash: 'book-hash',
      pageId: PAGE_ID,
      title: 'Book',
    });
    notes.set(`${TARGET_ID}:book-hash:note-1`, {
      targetId: TARGET_ID,
      bookHash: 'book-hash',
      noteId: 'note-1',
      payloadHash: 'old-hash',
      blockIds: ['old-1', 'old-2'],
      staleBlockIds: [],
    });
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: PAGE_ID }))
      .mockResolvedValueOnce(
        jsonResponse({ results: Array.from({ length: 5 }, (_, i) => ({ id: `new-${i}` })) }),
      )
      .mockResolvedValueOnce(jsonResponse({ id: 'old-1', archived: true }))
      .mockResolvedValueOnce(jsonResponse({ id: 'old-2', archived: true }));

    const result = await new NotionClient(makeSettings(), store).syncBookNotes(
      'book-hash',
      'Book',
      [makeNote({ updatedAt: 1_800_000_000_000 })],
      () => 'Chapter',
    );

    expect(result).toEqual({ success: true, inserted: 0, updated: 1, deleted: 0, skipped: 0 });
    const replacementWrite = writes.find((mapping) => mapping.blockIds[0] === 'new-0');
    expect(replacementWrite).toEqual(
      expect.objectContaining({ blockIds: ['new-0', 'new-1', 'new-2', 'new-3', 'new-4'] }),
    );
    expect(replacementWrite!.staleBlockIds).toEqual(['old-1', 'old-2']);
    expect(fetchMock.mock.calls.slice(2).map((call) => call[0])).toEqual([
      '/api/notion/blocks/old-1',
      '/api/notion/blocks/old-2',
    ]);
    expect((fetchMock.mock.calls[2]![1] as RequestInit).method).toBe('DELETE');
    expect(writes.at(-1)!.staleBlockIds).toEqual([]);
  });

  test('resumes stale-block cleanup after a failed delete without appending the replacement twice', async () => {
    const { store, pages, notes } = makeStore();
    pages.set(`${TARGET_ID}:book-hash`, {
      targetId: TARGET_ID,
      bookHash: 'book-hash',
      pageId: PAGE_ID,
      title: 'Book',
    });
    notes.set(`${TARGET_ID}:book-hash:note-1`, {
      targetId: TARGET_ID,
      bookHash: 'book-hash',
      noteId: 'note-1',
      payloadHash: 'old-hash',
      blockIds: ['old-1'],
      staleBlockIds: [],
    });
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: PAGE_ID }))
      .mockResolvedValueOnce(
        jsonResponse({ results: Array.from({ length: 5 }, (_, i) => ({ id: `new-${i}` })) }),
      )
      .mockResolvedValueOnce(jsonResponse({ message: 'cleanup failed' }, 500))
      .mockResolvedValueOnce(jsonResponse({ message: 'already archived' }, 404));
    const client = new NotionClient(makeSettings(), store);
    const changedNote = makeNote({ updatedAt: 1_800_000_000_000 });

    const interrupted = await client.syncBookNotes(
      'book-hash',
      'Book',
      [changedNote],
      () => 'Chapter',
    );
    const resumed = await client.syncBookNotes('book-hash', 'Book', [changedNote], () => 'Chapter');

    expect(interrupted.success).toBe(false);
    expect(resumed).toEqual({ success: true, inserted: 0, updated: 0, deleted: 0, skipped: 1 });
    expect(
      fetchMock.mock.calls.filter(([url]) => url === `/api/notion/blocks/${PAGE_ID}/children`),
    ).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/notion/blocks/old-1')).toHaveLength(
      2,
    );
    expect(notes.get(`${TARGET_ID}:book-hash:note-1`)?.staleBlockIds).toEqual([]);
  });

  test('archives mapped blocks when a note is deleted without appending new content', async () => {
    const { store, pages, notes } = makeStore();
    pages.set(`${TARGET_ID}:book-hash`, {
      targetId: TARGET_ID,
      bookHash: 'book-hash',
      pageId: PAGE_ID,
      title: 'Book',
    });
    notes.set(`${TARGET_ID}:book-hash:note-1`, {
      targetId: TARGET_ID,
      bookHash: 'book-hash',
      noteId: 'note-1',
      payloadHash: 'old-hash',
      blockIds: ['old-1'],
      staleBlockIds: [],
    });
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'old-1', archived: true }));

    const result = await new NotionClient(makeSettings(), store).syncBookNotes(
      'book-hash',
      'Book',
      [makeNote({ deletedAt: 1_800_000_000_000 })],
      () => null,
    );

    expect(result).toEqual({ success: true, inserted: 0, updated: 0, deleted: 1, skipped: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe('DELETE');
  });

  test('splits rich text at 2,000 characters and keeps append batches under 100 blocks', async () => {
    const { store } = makeStore();
    const longText = '🙂'.repeat(2_001);
    const notes = Array.from({ length: 40 }, (_, i) =>
      makeNote({ id: `note-${i}`, cfi: `epubcfi(/6/${i + 2}!/4)`, text: longText, note: '' }),
    );
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [], has_more: false }))
      .mockResolvedValueOnce(jsonResponse({ id: PAGE_ID }));
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      const children = JSON.parse(init?.body as string).children as unknown[];
      return jsonResponse({ results: children.map((_, i) => ({ id: `block-${i}` })) });
    });

    const result = await new NotionClient(makeSettings(), store).syncBookNotes(
      'book-hash',
      'Book',
      notes,
      () => null,
    );

    expect(result.success).toBe(true);
    const appendCalls = fetchMock.mock.calls.slice(2);
    expect(appendCalls.length).toBeGreaterThan(1);
    for (const [, init] of appendCalls) {
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.children.length).toBeLessThanOrEqual(100);
      for (const block of body.children) {
        const value = block[block.type];
        for (const richText of value.rich_text ?? []) {
          expect(Array.from(richText.text.content).length).toBeLessThanOrEqual(2_000);
        }
      }
    }
  });

  test('resumes after a later append batch fails without replaying an earlier successful batch', async () => {
    const { store } = makeStore();
    const appendBodies: string[] = [];
    let appendNumber = 0;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === `/api/notion/data_sources/${TARGET_ID}/query`) {
        return jsonResponse({ results: [], has_more: false });
      }
      if (url === '/api/notion/pages') return jsonResponse({ id: PAGE_ID });
      if (url === `/api/notion/pages/${PAGE_ID}`) return jsonResponse({ id: PAGE_ID });
      const body = init?.body as string;
      appendBodies.push(body);
      appendNumber += 1;
      if (appendNumber === 2) return jsonResponse({ message: 'interrupted' }, 500);
      const children = JSON.parse(body).children as unknown[];
      return jsonResponse({
        results: children.map((_, i) => ({ id: `batch-${appendNumber}-${i}` })),
      });
    });
    const client = new NotionClient(makeSettings(), store);
    const hugeNote = makeNote({ text: '🙂'.repeat(120_000), note: '' });

    const interrupted = await client.syncBookNotes('book-hash', 'Book', [hugeNote], () => null);
    const resumed = await client.syncBookNotes('book-hash', 'Book', [hugeNote], () => null);

    expect(interrupted.success).toBe(false);
    expect(resumed.success).toBe(true);
    expect(appendBodies.length).toBe(3);
    expect(appendBodies[2]).not.toBe(appendBodies[0]);
  });

  test('retries a 429 using Retry-After', async () => {
    const client = new NotionClient(makeSettings());
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: 'slow down' }, 429, { 'retry-after': '0' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'me' }));

    await expect(client.validateToken()).resolves.toEqual({ valid: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('uses the direct Notion API transport on Tauri', async () => {
    vi.mocked(isTauriAppPlatform).mockReturnValue(true);
    vi.mocked(tauriFetch).mockResolvedValueOnce(jsonResponse({ id: 'me' }));

    await expect(new NotionClient(makeSettings()).validateToken()).resolves.toEqual({
      valid: true,
    });

    expect(tauriFetch).toHaveBeenCalledWith(`${NOTION_API_BASE_URL}/users/me`, {
      method: 'GET',
      headers: {
        Authorization: 'Bearer secret_test',
        'Notion-Version': NOTION_API_VERSION,
      },
      body: undefined,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('retries a 529 append using Retry-After', async () => {
    const { store } = makeStore();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ results: [], has_more: false }))
      .mockResolvedValueOnce(jsonResponse({ id: PAGE_ID }))
      .mockResolvedValueOnce(
        jsonResponse({ message: 'temporarily overloaded' }, 529, { 'retry-after': '0' }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ results: Array.from({ length: 5 }, (_, i) => ({ id: `block-${i}` })) }),
      );

    const result = await new NotionClient(makeSettings(), store).syncBookNotes(
      'book-hash',
      'Book',
      [makeNote()],
      () => 'Chapter',
    );

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.slice(2).map((call) => call[0])).toEqual([
      `/api/notion/blocks/${PAGE_ID}/children`,
      `/api/notion/blocks/${PAGE_ID}/children`,
    ]);
  });
});
