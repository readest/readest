import { describe, it, expect, beforeEach, vi } from 'vitest';
import { downloadAbsForOffline, loadAbsOfflineManifest } from '@/services/audiobookshelf/offline';
import { useABSServerStore } from '@/store/absServerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { getAbsOfflineDir, makeAbsFilePath } from '@/utils/audiobook';
import { getLocalBookFilename } from '@/utils/book';
import type { ABSLibraryItem, ABSServer } from '@/types/audiobookshelf';
import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
import type { SystemSettings } from '@/types/settings';

const { getItemExpandedMock, refreshOrReloginMock, downloadFileMock, renameMock } = vi.hoisted(
  () => ({
    getItemExpandedMock: vi.fn(),
    refreshOrReloginMock: vi.fn(),
    downloadFileMock: vi.fn(),
    renameMock: vi.fn(),
  }),
);

vi.mock('@/services/sync/replicaPublish', () => ({
  publishReplicaUpsert: vi.fn(),
  publishReplicaDelete: vi.fn(),
}));
vi.mock('@/services/audiobookshelf/createClient', () => ({
  createAbsClient: () => ({
    getItemExpanded: getItemExpandedMock,
    refreshOrRelogin: refreshOrReloginMock,
  }),
}));
vi.mock('@/libs/storage', () => ({ downloadFile: downloadFileMock }));
vi.mock('@tauri-apps/plugin-fs', () => ({ rename: renameMock }));

const server: ABSServer = {
  id: 'srv1',
  contentId: 'srv1',
  addedAt: 1,
  name: 'Home',
  url: 'http://abs.local',
  accessToken: 'tok1',
};

const makeBook = (overrides: Partial<Book> = {}): Book =>
  ({
    hash: 'bookhash',
    format: 'ABS',
    title: 'Alice',
    author: 'Carroll',
    filePath: makeAbsFilePath('srv1', 'item1'),
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }) as Book;

const audiobookItem = {
  id: 'item1',
  mediaType: 'book',
  media: {
    metadata: { title: 'Alice' },
    duration: 30,
    tracks: [
      {
        index: 1,
        startOffset: 0,
        duration: 10,
        contentUrl: '/api/items/item1/file/11',
        mimeType: 'audio/mpeg',
        metadata: { filename: '01 Down the Rabbit-Hole.mp3', size: 100 },
      },
      {
        index: 2,
        startOffset: 10,
        duration: 20,
        contentUrl: '/api/items/item1/file/12',
        mimeType: 'audio/mpeg',
        metadata: { filename: '02.mp3', size: 300 },
      },
    ],
    chapters: [{ id: 0, start: 0, end: 30, title: 'Chapter 1' }],
  },
} as unknown as ABSLibraryItem;

const makeAppService = (existing: string[] = []) => {
  const files = new Map<string, string>();
  return {
    files,
    service: {
      exists: vi.fn(async (path: string) => existing.includes(path) || files.has(path)),
      resolveFilePath: vi.fn(async (path: string) => `/books/${path}`),
      createDir: vi.fn(async () => {}),
      writeFile: vi.fn(async (path: string, _base: string, content: string) => {
        files.set(path, content);
      }),
      readFile: vi.fn(async (path: string) => {
        if (!files.has(path)) throw new Error('not found');
        return files.get(path)!;
      }),
    } as unknown as AppService,
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  useABSServerStore.setState({ servers: [server] });
  useSettingsStore.setState({ settings: { absServers: [] } as unknown as SystemSettings });
  getItemExpandedMock.mockResolvedValue(audiobookItem);
  downloadFileMock.mockResolvedValue({});
  renameMock.mockResolvedValue(undefined);
});

describe('downloadAbsForOffline — audiobook', () => {
  it('downloads every track, then writes the manifest last', async () => {
    const { service, files } = makeAppService();
    const progress = vi.fn();
    downloadFileMock.mockResolvedValueOnce({}).mockImplementationOnce(async ({ onProgress }) => {
      onProgress({ progress: 150, total: 300, transferSpeed: 5 });
      return {};
    });

    await downloadAbsForOffline(service, makeBook(), progress);

    const dir = getAbsOfflineDir('bookhash');
    const track1 = `${dir}/1-01 Down the Rabbit-Hole.mp3`;
    const track2 = `${dir}/2-02.mp3`;
    expect(downloadFileMock.mock.calls.map(([args]) => [args.url, args.dst])).toEqual([
      ['http://abs.local/api/items/item1/file/11', `/books/${track1}.part`],
      ['http://abs.local/api/items/item1/file/12', `/books/${track2}.part`],
    ]);
    expect(downloadFileMock.mock.calls[0]![0]).toMatchObject({
      headers: { Authorization: 'Bearer tok1' },
      skipSslVerification: true,
    });
    expect(renameMock.mock.calls).toEqual([
      [`/books/${track1}.part`, `/books/${track1}`],
      [`/books/${track2}.part`, `/books/${track2}`],
    ]);

    const manifest = JSON.parse(files.get(`${dir}/manifest.json`)!);
    expect(manifest).toMatchObject({
      itemId: 'item1',
      duration: 30,
      chapters: [{ id: 0, start: 0, end: 30, title: 'Chapter 1' }],
    });
    expect(manifest.tracks.map((t: { contentUrl: string }) => t.contentUrl)).toEqual([
      track1,
      track2,
    ]);
    // The manifest is the completion marker: nothing is written before the tracks land.
    expect(vi.mocked(service.writeFile).mock.invocationCallOrder[0]).toBeGreaterThan(
      renameMock.mock.invocationCallOrder[1]!,
    );

    // Progress spans the whole item, not each file.
    expect(progress).toHaveBeenCalledWith({ progress: 250, total: 400, transferSpeed: 5 });
  });

  it('skips tracks a previous attempt already finished', async () => {
    const dir = getAbsOfflineDir('bookhash');
    const { service } = makeAppService([`${dir}/1-01 Down the Rabbit-Hole.mp3`]);

    await downloadAbsForOffline(service, makeBook());

    expect(downloadFileMock).toHaveBeenCalledTimes(1);
    expect(downloadFileMock.mock.calls[0]![0].url).toBe('http://abs.local/api/items/item1/file/12');
  });

  it('refreshes an expired token and retries the file once', async () => {
    const { service } = makeAppService();
    downloadFileMock.mockRejectedValueOnce('request failed with status code 401: Unauthorized');
    refreshOrReloginMock.mockImplementation(async () => {
      useABSServerStore.setState({ servers: [{ ...server, accessToken: 'tok2' }] });
    });

    await downloadAbsForOffline(service, makeBook());

    expect(refreshOrReloginMock).toHaveBeenCalledTimes(1);
    expect(downloadFileMock.mock.calls[1]![0].headers).toEqual({ Authorization: 'Bearer tok2' });
    expect(downloadFileMock).toHaveBeenCalledTimes(3);
  });

  it('names files by their position, not the server-supplied index', async () => {
    const { service } = makeAppService();
    getItemExpandedMock.mockResolvedValue({
      ...audiobookItem,
      media: {
        ...audiobookItem.media,
        tracks: [{ ...audiobookItem.media.tracks![0]!, index: '../../escape' as never }],
      },
    });

    await downloadAbsForOffline(service, makeBook());

    expect(downloadFileMock.mock.calls[0]![0].dst).toBe(
      `/books/${getAbsOfflineDir('bookhash')}/1-01 Down the Rabbit-Hole.mp3.part`,
    );
  });

  it('stops between files once cancelled, without a manifest', async () => {
    const { service, files } = makeAppService();
    const controller = new AbortController();
    downloadFileMock.mockImplementationOnce(async () => {
      controller.abort();
      return {};
    });

    await expect(
      downloadAbsForOffline(service, makeBook(), undefined, controller.signal),
    ).rejects.toThrow();

    expect(downloadFileMock).toHaveBeenCalledTimes(1);
    expect(files.size).toBe(0);
  });
});

describe('downloadAbsForOffline — ebook-only item', () => {
  it('downloads the ebook to the managed book path the reader opens', async () => {
    const { service, files } = makeAppService();
    getItemExpandedMock.mockResolvedValue({
      id: 'item1',
      mediaType: 'book',
      media: {
        metadata: { title: 'Alice' },
        ebookFile: { ino: '9', ebookFormat: 'epub', metadata: { size: 1000 } },
      },
    });
    const book = makeBook({ absMediaType: 'ebook', metadata: { absMediaType: 'ebook' } as never });

    await downloadAbsForOffline(service, book);

    const managed = getLocalBookFilename(book);
    expect(downloadFileMock).toHaveBeenCalledTimes(1);
    expect(downloadFileMock.mock.calls[0]![0]).toMatchObject({
      url: 'http://abs.local/api/items/item1/ebook',
      dst: `/books/${managed}.part`,
    });
    expect(renameMock).toHaveBeenCalledWith(`/books/${managed}.part`, `/books/${managed}`);
    expect(files.size).toBe(0);
  });
});

describe('downloadAbsForOffline — media type from the book row', () => {
  // A metadata edit rewrites `metadata` wholesale, dropping the ABS mirror
  // until the next library sync; the top-level field still says ebook.
  it('treats an ebook as an ebook even without its metadata mirror', async () => {
    const { service } = makeAppService();
    getItemExpandedMock.mockResolvedValue({
      id: 'item1',
      mediaType: 'book',
      media: { metadata: { title: 'Alice' }, ebookFile: { ino: '9', ebookFormat: 'epub' } },
    });

    await downloadAbsForOffline(service, makeBook({ absMediaType: 'ebook' }));

    expect(downloadFileMock.mock.calls[0]![0].url).toBe('http://abs.local/api/items/item1/ebook');
  });
});

describe('loadAbsOfflineManifest', () => {
  it('returns the manifest of a finished download, else null', async () => {
    const { service, files } = makeAppService();
    expect(await loadAbsOfflineManifest(service, 'bookhash')).toBeNull();

    files.set(`${getAbsOfflineDir('bookhash')}/manifest.json`, '{not json');
    expect(await loadAbsOfflineManifest(service, 'bookhash')).toBeNull();

    const manifest = { itemId: 'item1', duration: 30, chapters: [], tracks: [] };
    files.set(`${getAbsOfflineDir('bookhash')}/manifest.json`, JSON.stringify(manifest));
    expect(await loadAbsOfflineManifest(service, 'bookhash')).toEqual(manifest);
  });
});
