import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { KOSyncClient } from '@/services/sync/KOSyncClient';
import { Book } from '@/types/book';
import { KOSyncSettings } from '@/types/settings';

// The LAN-server branch of KOSyncClient.request uses window.fetch (mocked
// per-test); the Tauri HTTP plugin is never invoked here, so stub the import
// to keep the unit environment free of Tauri internals.
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));

const makeConfig = (overrides: Partial<KOSyncSettings> = {}): KOSyncSettings => ({
  enabled: true,
  // A LAN address makes request() take the direct window.fetch path.
  serverUrl: 'http://192.168.1.50',
  username: 'alice',
  userkey: '',
  password: '',
  deviceId: 'device-1',
  deviceName: 'Readest',
  checksumMethod: 'binary',
  strategy: 'prompt',
  ...overrides,
});

type FetchMock = ReturnType<typeof vi.fn>;

const setFetch = (impl: (...args: unknown[]) => unknown): FetchMock => {
  const mock = vi.fn(impl) as FetchMock;
  vi.stubGlobal('fetch', mock);
  window.fetch = mock as unknown as typeof window.fetch;
  return mock;
};

// Minimal Response-like object covering the fields KOSyncClient reads.
const htmlPage = (status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => {
    throw new SyntaxError('Unexpected token < in JSON');
  },
});

const jsonResponse = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const makeBook = (): Book =>
  ({
    hash: 'f248ce0f15105ff390e5292085e0622b',
    title: 'A Book',
  }) as Book;

describe('KOSyncClient – filename checksums', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ['My Book.epub', '9a671b9d07b5404d84ce60af27058b04'],
    ['阅读 Café 100%20.EPUB', '0df8ac8a37723d854b27eeb11dd337c5'],
    ['first\\chapter.pdf', 'e2cae7b1d6c9d35e1537f242ebd9f950'],
    ['one/part.pdf', '5311de6b0b50b8d4725340dda1c2990e'],
  ])('hashes the exact original basename %s, including its extension', (originalFilename, digest) => {
    const client = new KOSyncClient(makeConfig({ checksumMethod: 'filename' }));
    const book = {
      ...makeBook(),
      originalFilename,
      sourceTitle: 'Managed name',
      title: 'Edited title',
    };
    expect(client.getDocumentDigest(book)).toBe(digest);
    expect(client.getDocumentDigest({ ...book, hash: 'optimized-file-content' })).toBe(digest);
  });

  it('keeps using the content hash when File Content is selected', () => {
    const client = new KOSyncClient(makeConfig());
    const book = { ...makeBook(), originalFilename: 'My Book.epub' };
    expect(client.getDocumentDigest(book)).toBe(book.hash);
  });

  it.each([
    undefined,
    '',
  ])('uses title and extension without an original filename (%s)', (originalFilename) => {
    const client = new KOSyncClient(makeConfig({ checksumMethod: 'filename' }));
    const book: Book = {
      ...makeBook(),
      originalFilename,
      title: 'Edited title',
      sourceTitle: 'Managed name',
      format: 'EPUB',
      metadata: {
        title: 'Embedded title',
        author: 'Author',
        language: 'en',
        absFileHash: 'abs-content-hash',
      },
    };
    expect(client.getDocumentDigest(book)).toBe('c15ad0fcc7d0a60ecf61bcd69116c3c0');
    expect(client.getDocumentDigest({ ...book, hash: 'optimized-file-content' })).toBe(
      'c15ad0fcc7d0a60ecf61bcd69116c3c0',
    );
    expect(client.getDocumentDigest({ ...book, title: '阅读 Café 100%20', format: 'PDF' })).toBe(
      'eff390be0b42c506d89e5a2ef5b79c36',
    );
    expect(new KOSyncClient(makeConfig()).getDocumentDigest(book)).toBe('abs-content-hash');
  });

  it.each([
    ['My Book.epub', '9a671b9d07b5404d84ce60af27058b04'],
    [undefined, 'c15ad0fcc7d0a60ecf61bcd69116c3c0'],
  ])('pulls and pushes using the same filename digest (%s)', async (originalFilename, digest) => {
    const mock = setFetch(() => jsonResponse(200, { percentage: 0.5 }));
    const book: Book = { ...makeBook(), title: 'Edited title', format: 'EPUB', originalFilename };
    const client = new KOSyncClient(makeConfig({ userkey: 'key', checksumMethod: 'filename' }));

    const progress = await client.getProgress(book);
    await client.updateProgress(book, '/body/DocFragment[12]', 0.5);

    expect(mock.mock.calls[0]![0]).toBe(`http://192.168.1.50/syncs/progress/${digest}`);
    expect(progress?.document).toBe(digest);
    const putInit = mock.mock.calls[1]![1] as RequestInit;
    expect(JSON.parse(putInit.body as string).document).toBe(digest);
  });
});

describe('KOSyncClient.getProgress – server response shapes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('accepts a progress payload that omits `document`', async () => {
    // Not every KOSync-compatible server echoes the document hash back on GET.
    // koreader-sync only selects progress/percentage/device/device_id/timestamp,
    // so requiring `document` silently discarded a perfectly good remote
    // position and the reader then pushed its stale one over it. (#5063, #5065)
    setFetch(() =>
      jsonResponse(200, {
        progress: '/body/DocFragment[3]/body/div/p[12].0',
        percentage: 0.0174,
        device: 'KindlePaperWhite5',
        device_id: '8F6F541940B74D32B606503DB6B43E0F',
        timestamp: 1783773009,
      }),
    );

    const client = new KOSyncClient(makeConfig({ userkey: 'key' }));
    const progress = await client.getProgress(makeBook());

    expect(progress).not.toBeNull();
    expect(progress!.progress).toBe('/body/DocFragment[3]/body/div/p[12].0');
    expect(progress!.percentage).toBe(0.0174);
    // The requested hash stands in for the document the server left out.
    expect(progress!.document).toBe('f248ce0f15105ff390e5292085e0622b');
  });

  it('accepts a progress payload that includes `document`', async () => {
    setFetch(() =>
      jsonResponse(200, {
        document: 'f248ce0f15105ff390e5292085e0622b',
        progress: '/body/DocFragment[3]/body/div/p[12].0',
        percentage: 0.0174,
        timestamp: 1783773009,
      }),
    );

    const client = new KOSyncClient(makeConfig({ userkey: 'key' }));
    const progress = await client.getProgress(makeBook());

    expect(progress!.document).toBe('f248ce0f15105ff390e5292085e0622b');
  });

  it('returns null when a 200 body carries no usable position', async () => {
    // Some servers answer "no progress stored" with 200 and a status body
    // instead of a 404; that must not be mistaken for a remote position.
    setFetch(() => jsonResponse(200, { status: 'not found' }));

    const client = new KOSyncClient(makeConfig({ userkey: 'key' }));

    expect(await client.getProgress(makeBook())).toBeNull();
  });

  it('returns null when the server answers 404', async () => {
    setFetch(() => jsonResponse(404, { status: 'not found' }));

    const client = new KOSyncClient(makeConfig({ userkey: 'key' }));

    expect(await client.getProgress(makeBook())).toBeNull();
  });
});

describe('KOSyncClient.connect – server validation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fails when /users/auth returns 200 with a non-JSON (web UI) page', async () => {
    // A wrong Server URL that lands on the server's static web UI returns the
    // HTML index page with 200 OK. That must NOT be treated as a successful
    // login (it isn't a KOReader sync endpoint).
    setFetch(() => htmlPage(200));

    const client = new KOSyncClient(makeConfig());
    const result = await client.connect('alice', 'secret');

    expect(result.success).toBe(false);
  });

  it('succeeds when /users/auth returns a valid KOReader auth JSON', async () => {
    setFetch(() => jsonResponse(200, { authorized: 'OK' }));

    const client = new KOSyncClient(makeConfig());
    const result = await client.connect('alice', 'secret');

    expect(result.success).toBe(true);
  });

  it('fails when registration (/users/create) returns 200 with a non-JSON page', async () => {
    // /users/auth → 401 routes connect() into the create path; a web UI that
    // returns 200 HTML there must not be reported as a successful registration.
    const mock = setFetch((url: unknown) => {
      if (String(url).includes('/users/create')) return htmlPage(200);
      return htmlPage(401); // auth fails -> triggers create
    });

    const client = new KOSyncClient(makeConfig());
    const result = await client.connect('alice', 'secret');

    expect(result.success).toBe(false);
    expect(mock).toHaveBeenCalled();
  });
});

describe('KOSyncClient.checkConnection', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('never registers an account when the credentials are refused', async () => {
    const fetchMock = setFetch(async () => jsonResponse(401, { message: 'Unauthorized' }));

    const result = await new KOSyncClient(makeConfig()).checkConnection();

    expect(result).toEqual({ success: false, message: 'Invalid credentials.' });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
    for (const [url] of fetchMock.mock.calls) expect(String(url)).toContain('/users/auth');
  });

  it('passes for a KOReader Sync server that accepts the login', async () => {
    setFetch(async () => jsonResponse(200, { authorized: 'OK' }));

    expect((await new KOSyncClient(makeConfig()).checkConnection()).success).toBe(true);
  });

  it('fails on a web page answering at the server URL', async () => {
    setFetch(async () => htmlPage());

    expect((await new KOSyncClient(makeConfig()).checkConnection()).success).toBe(false);
  });

  it('reports an unreachable server', async () => {
    setFetch(async () => {
      throw new Error('Network down');
    });

    expect(await new KOSyncClient(makeConfig()).checkConnection()).toEqual({
      success: false,
      message: 'Network down',
    });
  });
});

describe('KOSyncClient.lastError', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const client = () => new KOSyncClient(makeConfig({ userkey: 'key' }));

  it('names a failed read', async () => {
    setFetch(async () => jsonResponse(500, {}));
    const kosync = client();

    expect(await kosync.getProgress(makeBook())).toBeNull();
    expect(kosync.lastError).toBe('HTTP 500');
  });

  it('stays empty when the server has no position for the book', async () => {
    setFetch(async () => jsonResponse(404, {}));
    const kosync = client();

    expect(await kosync.getProgress(makeBook())).toBeNull();
    expect(kosync.lastError).toBeNull();
  });

  it('names a refused write and clears after one that works', async () => {
    setFetch(async () => jsonResponse(403, {}));
    const kosync = client();

    expect(await kosync.updateProgress(makeBook(), 'pos', 0.5)).toBe(false);
    expect(kosync.lastError).toBe('HTTP 403');

    setFetch(async () => jsonResponse(200, {}));
    expect(await kosync.updateProgress(makeBook(), 'pos', 0.5)).toBe(true);
    expect(kosync.lastError).toBeNull();
  });
});

describe('KOSyncClient – custom headers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends configured custom headers on requests', async () => {
    const mock = setFetch(() => jsonResponse(200, { authorized: 'OK' }));

    const client = new KOSyncClient(
      makeConfig({ customHeaders: { 'CF-Access-Client-Id': 'client-id' } }),
    );
    await client.connect('alice', 'secret');

    const [, init] = mock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    // Headers.entries() lowercases header names, so the merged plain object
    // built off it does too.
    expect(headers['cf-access-client-id']).toBe('client-id');
  });

  it('does not let custom headers override KOSync auth headers', async () => {
    const mock = setFetch(() => jsonResponse(200, { authorized: 'OK' }));

    const client = new KOSyncClient(
      makeConfig({
        userkey: 'real-key',
        customHeaders: { 'X-Auth-Key': 'attacker-supplied' },
      }),
    );
    await client.getProgress(makeBook());

    const [, init] = mock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['x-auth-key']).toBe('real-key');
  });
});

describe('KOSyncClient.updateProgress – document metadata', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const sentBody = (mock: FetchMock): Record<string, unknown> => {
    const [, init] = mock.mock.calls[0] as [string, RequestInit];
    return JSON.parse(init.body as string);
  };

  it('omits metadata by default, matching KOReader', async () => {
    const mock = setFetch(() => jsonResponse(200, {}));

    const client = new KOSyncClient(makeConfig({ userkey: 'key' }));
    await client.updateProgress(makeBook(), '/body/DocFragment[12]', 0.14);

    expect(sentBody(mock)).not.toHaveProperty('metadata');
  });

  it('sends filename, title and authors when Send Document Metadata is on', async () => {
    const mock = setFetch(() => jsonResponse(200, {}));

    const book = {
      ...makeBook(),
      title: 'The Count of Monte Cristo',
      author: 'Alexandre Dumas',
      format: 'EPUB',
    } as Book;
    const client = new KOSyncClient(makeConfig({ userkey: 'key', sendMetadata: true }));
    await client.updateProgress(book, '/body/DocFragment[12]', 0.14);

    const body = sentBody(mock);
    expect(body['metadata']).toEqual({
      filename: 'The Count of Monte Cristo.epub',
      title: 'The Count of Monte Cristo',
      authors: 'Alexandre Dumas',
    });
    // The standard fields are unchanged next to it.
    expect(body['document']).toBe(book.hash);
    expect(body['percentage']).toBe(0.14);
  });

  it('newline-joins structured authors instead of sending localized display punctuation', async () => {
    const mock = setFetch(() => jsonResponse(200, {}));

    const book = {
      ...makeBook(),
      author: 'Alexandre Dumas et Auguste Maquet',
      format: 'EPUB',
      metadata: {
        author: [{ name: { en: 'Alexandre Dumas' } }, { name: { en: 'Auguste Maquet' } }],
      },
    } as unknown as Book;
    const client = new KOSyncClient(makeConfig({ userkey: 'key', sendMetadata: true }));
    await client.updateProgress(book, '/body/DocFragment[12]', 0.14);

    const metadata = sentBody(mock)['metadata'] as Record<string, string>;
    expect(metadata['authors']).toBe('Alexandre Dumas\nAuguste Maquet');
  });

  it.each([
    {
      label: 'trims string contributors and string names',
      metadataAuthors: [' Alexandre Dumas ', { name: ' Auguste Maquet ' }],
      expected: 'Alexandre Dumas\nAuguste Maquet',
    },
    {
      label: 'uses the first non-empty translated name when the user language is missing',
      metadataAuthors: [null, { name: { fr: ' Victor Hugo ' } }],
      expected: 'Victor Hugo',
    },
    {
      label: 'falls back to the display author when no structured name is usable',
      metadataAuthors: [null, {}, { name: { en: '  ' } }],
      expected: 'Fallback Author',
    },
  ])('$label', async ({ metadataAuthors, expected }) => {
    const mock = setFetch(() => jsonResponse(200, {}));
    const book = {
      ...makeBook(),
      author: 'Fallback Author',
      format: 'EPUB',
      metadata: { author: metadataAuthors },
    } as unknown as Book;
    const client = new KOSyncClient(makeConfig({ userkey: 'key', sendMetadata: true }));

    await client.updateProgress(book, '/body/DocFragment[12]', 0.14);

    const metadata = sentBody(mock)['metadata'] as Record<string, string>;
    expect(metadata['authors']).toBe(expected);
  });

  it('names the file by its source title when that differs from the display title', async () => {
    const mock = setFetch(() => jsonResponse(200, {}));

    const book = {
      ...makeBook(),
      title: 'A Title the Reader Edited',
      sourceTitle: 'original_import_name',
      author: 'Someone',
      format: 'EPUB',
    } as Book;
    const client = new KOSyncClient(makeConfig({ userkey: 'key', sendMetadata: true }));
    await client.updateProgress(book, '/body/DocFragment[1]', 0.5);

    const metadata = sentBody(mock)['metadata'] as Record<string, string>;
    expect(metadata['filename']).toBe('original_import_name.epub');
    // The title stays the one the user sees.
    expect(metadata['title']).toBe('A Title the Reader Edited');
  });
});

describe('KOSyncClient – Audiobookshelf ebooks', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // The book's hash is the md5 of its abs:// path; KOReader keys the same
  // EPUB by the partial MD5 of its file (#7088).
  it("pulls and pushes under the file's own id", async () => {
    const fileHash = '0123456789abcdef0123456789abcdef';
    const mock = setFetch(() => jsonResponse(200, {}));
    const book = {
      ...makeBook(),
      format: 'ABS',
      metadata: { absMediaType: 'ebook', absFileHash: fileHash },
    } as unknown as Book;
    const client = new KOSyncClient(makeConfig({ userkey: 'key' }));

    await client.getProgress(book);
    await client.updateProgress(book, '/body/DocFragment[12]', 0.14);

    const [[getUrl], [, putInit]] = mock.mock.calls as [
      [string, RequestInit],
      [string, RequestInit],
    ];
    expect(getUrl).toBe(`http://192.168.1.50/syncs/progress/${fileHash}`);
    expect(JSON.parse(putInit.body as string)['document']).toBe(fileHash);
  });
});

describe('KOSyncClient – TLS certificate checks', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const requestInit = async (overrides: Partial<KOSyncSettings>) => {
    const fetchMock = setFetch(() => jsonResponse(200, { percentage: 0.5 }));
    await new KOSyncClient(makeConfig({ userkey: 'key', ...overrides })).getProgress(makeBook());
    return fetchMock.mock.calls[0]![1] as Record<string, unknown>;
  };

  it('verifies certificates for a server that does not allow self-signed ones', async () => {
    expect(await requestInit({ allowSelfSignedCert: false })).not.toHaveProperty('danger');
  });

  it('accepts self-signed certificates when the server allows them', async () => {
    expect(await requestInit({ allowSelfSignedCert: true })).toMatchObject({
      danger: { acceptInvalidCerts: true, acceptInvalidHostnames: true },
    });
  });

  it('keeps accepting them for a server saved before the option existed', async () => {
    expect(await requestInit({})).toHaveProperty('danger');
  });
});
