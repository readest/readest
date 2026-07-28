import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';

// Issue #5352: a single transient upload failure used to poison the Discord
// cover for a full hour — the presence kept showing the fallback book icon
// long after the network recovered, which is why the reporter saw covers
// "stop working" for books that had rendered fine minutes earlier. Transient
// failures must be retried quickly (with backoff); only a genuinely missing
// cover deserves a long negative cache.

const invokeMock = vi.fn();
const processDiscordCoverMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...a: unknown[]) => invokeMock(...a),
}));
vi.mock('@/utils/image', () => ({
  processDiscordCover: (...a: unknown[]) => processDiscordCoverMock(...a),
}));

const BOOK = {
  hash: 'bookhash1234',
  title: 'Lord of the Flies',
  author: 'William Golding',
  coverHash: 'coverhashabcd',
} as Book;

type Svc = AppService & {
  exists: ReturnType<typeof vi.fn>;
  uploadFileToCloud: ReturnType<typeof vi.fn>;
  writeFile: ReturnType<typeof vi.fn>;
};

const makeAppService = (): Svc =>
  ({
    isDesktopApp: true,
    exists: vi.fn().mockResolvedValue(true),
    resolveFilePath: vi.fn().mockResolvedValue('/books/cover.png'),
    getImageURL: vi.fn().mockResolvedValue('asset://cover.png'),
    writeFile: vi.fn().mockResolvedValue(undefined),
    uploadFileToCloud: vi.fn().mockResolvedValue('https://storage.readest.com/temp/img/u/c.jpg'),
  }) as unknown as Svc;

const loadDiscord = async () => {
  vi.resetModules();
  return import('@/utils/discord');
};

const lastPresence = () =>
  invokeMock.mock.calls.filter((c) => c[0] === 'update_book_presence').at(-1)?.[1] as
    | { presence: { coverUrl: string | null } }
    | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-28T12:00:00Z'));
  invokeMock.mockReset().mockResolvedValue(undefined);
  processDiscordCoverMock.mockReset().mockResolvedValue({
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Discord cover URL cache', () => {
  it('names the uploaded file by cover hash so the public URL is content-addressed', async () => {
    const { updateDiscordPresence } = await loadDiscord();
    const appService = makeAppService();
    appService.exists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await updateDiscordPresence(BOOK, Date.now(), appService);

    expect(appService.uploadFileToCloud).toHaveBeenCalledWith(
      'drp_coverhashabcd.jpg',
      'drp_coverhashabcd.jpg',
      'Cache',
      expect.any(Function),
      BOOK.hash,
      true,
    );
  });

  it('falls back to the book hash when the cover hash is unknown', async () => {
    const { updateDiscordPresence } = await loadDiscord();
    const appService = makeAppService();
    appService.exists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await updateDiscordPresence({ ...BOOK, coverHash: null } as Book, Date.now(), appService);

    expect(appService.uploadFileToCloud).toHaveBeenCalledWith(
      'drp_bookhash1234.jpg',
      expect.anything(),
      'Cache',
      expect.any(Function),
      BOOK.hash,
      true,
    );
  });

  it('reuses a successful URL without re-uploading', async () => {
    const { updateDiscordPresence } = await loadDiscord();
    const appService = makeAppService();

    await updateDiscordPresence(BOOK, Date.now(), appService);
    await updateDiscordPresence(BOOK, Date.now(), appService);

    expect(appService.uploadFileToCloud).toHaveBeenCalledTimes(1);
    expect(lastPresence()?.presence.coverUrl).toBe('https://storage.readest.com/temp/img/u/c.jpg');
  });

  it('retries soon after a transient upload failure instead of waiting an hour', async () => {
    const { updateDiscordPresence } = await loadDiscord();
    const appService = makeAppService();
    appService.uploadFileToCloud.mockRejectedValueOnce(new Error('network down'));

    await updateDiscordPresence(BOOK, Date.now(), appService);
    expect(lastPresence()?.presence.coverUrl).toBeNull();

    // The 15s presence tick must not hammer the upload endpoint.
    vi.setSystemTime(new Date('2026-07-28T12:00:15Z'));
    await updateDiscordPresence(BOOK, Date.now(), appService);
    expect(appService.uploadFileToCloud).toHaveBeenCalledTimes(1);

    // ...but the cover comes back well within the old one-hour window.
    vi.setSystemTime(new Date('2026-07-28T12:01:00Z'));
    await updateDiscordPresence(BOOK, Date.now(), appService);
    expect(appService.uploadFileToCloud).toHaveBeenCalledTimes(2);
    expect(lastPresence()?.presence.coverUrl).toBe('https://storage.readest.com/temp/img/u/c.jpg');
  });

  it('backs off when transient failures keep repeating', async () => {
    const { updateDiscordPresence } = await loadDiscord();
    const appService = makeAppService();
    appService.uploadFileToCloud.mockRejectedValue(new Error('network down'));

    await updateDiscordPresence(BOOK, Date.now(), appService);
    vi.setSystemTime(new Date('2026-07-28T12:01:00Z'));
    await updateDiscordPresence(BOOK, Date.now(), appService);
    expect(appService.uploadFileToCloud).toHaveBeenCalledTimes(2);

    // Second failure doubles the window, so the next minute is a no-op.
    vi.setSystemTime(new Date('2026-07-28T12:02:00Z'));
    await updateDiscordPresence(BOOK, Date.now(), appService);
    expect(appService.uploadFileToCloud).toHaveBeenCalledTimes(2);

    vi.setSystemTime(new Date('2026-07-28T12:03:00Z'));
    await updateDiscordPresence(BOOK, Date.now(), appService);
    expect(appService.uploadFileToCloud).toHaveBeenCalledTimes(3);
  });

  it('does not re-check a missing cover on every tick', async () => {
    const { updateDiscordPresence } = await loadDiscord();
    const appService = makeAppService();
    appService.exists.mockResolvedValue(false);

    await updateDiscordPresence(BOOK, Date.now(), appService);
    vi.setSystemTime(new Date('2026-07-28T12:05:00Z'));
    await updateDiscordPresence(BOOK, Date.now(), appService);

    expect(appService.exists).toHaveBeenCalledTimes(1);
    expect(lastPresence()?.presence.coverUrl).toBeNull();
  });
});
