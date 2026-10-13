import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import environmentConfig from '@/services/environment';
import { createAbsEbookFetcher } from '@/services/audiobookshelf/ebookFetch';
import { useABSServerStore } from '@/store/absServerStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { ABSServer } from '@/types/audiobookshelf';
import type { AppService } from '@/types/system';
import type { SystemSettings } from '@/types/settings';

// absServerStore publishes replica upserts from its mutators (the token
// refresh goes through updateServer); the network side is irrelevant here.
vi.mock('@/services/sync/replicaPublish', () => ({
  publishReplicaUpsert: vi.fn(),
  publishReplicaDelete: vi.fn(),
}));

const server: ABSServer = {
  id: 's1',
  contentId: 's1',
  name: 'Home',
  url: 'http://abs.local:13378',
  username: 'u',
  password: 'p',
  accessToken: 'tok-1',
  refreshToken: 'rt-1',
};

const EBOOK = 'http://abs.local:13378/api/items/item-1/ebook';

const rangeResponse = () => new Response(new Uint8Array(4), { status: 206 });
const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('createAbsEbookFetcher', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let saveSettings: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    saveSettings = vi.fn(async () => {});
    vi.spyOn(environmentConfig, 'getAppService').mockResolvedValue({
      saveSettings,
    } as unknown as AppService);
    useABSServerStore.setState({ servers: [{ ...server }] });
    useSettingsStore.setState({ settings: {} as SystemSettings });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("sends every range read with the store's current token, not the one at open time", async () => {
    fetchMock.mockImplementation(async () => rangeResponse());
    const fetcher = createAbsEbookFetcher(server, 'item-1');

    await fetcher('ignored://placeholder', { headers: { Range: 'bytes=0-1023' } });
    expect(fetchMock.mock.calls[0]![0]).toBe(`${EBOOK}?token=tok-1`);
    expect((fetchMock.mock.calls[0]![1] as RequestInit).headers).toMatchObject({
      range: 'bytes=0-1023',
    });

    // A periodic library sync rotated the token behind the open reader.
    useABSServerStore.getState().updateServer('s1', { accessToken: 'tok-2' });
    await fetcher('ignored://placeholder', { headers: { Range: 'bytes=1024-2047' } });
    expect(fetchMock.mock.calls[1]![0]).toBe(`${EBOOK}?token=tok-2`);
  });

  it('refreshes the token on 401, persists it, and retries the read once', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(
        jsonResponse(200, { user: { accessToken: 'tok-3', refreshToken: 'rt-3' } }),
      )
      .mockResolvedValueOnce(rangeResponse());
    const fetcher = createAbsEbookFetcher(server, 'item-1');

    const res = await fetcher('ignored://placeholder', { headers: { Range: 'bytes=0-1023' } });

    expect(res.status).toBe(206);
    expect(fetchMock.mock.calls[1]![0]).toBe('http://abs.local:13378/auth/refresh');
    expect(fetchMock.mock.calls[2]![0]).toBe(`${EBOOK}?token=tok-3`);
    expect((fetchMock.mock.calls[2]![1] as RequestInit).headers).toMatchObject({
      range: 'bytes=0-1023',
    });
    expect(useABSServerStore.getState().getServer('s1')?.accessToken).toBe('tok-3');
    await vi.waitFor(() => expect(saveSettings).toHaveBeenCalled());
  });

  it('gives up after one retry instead of looping on a still-unauthorized stream', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 })) // refresh rejected
      .mockResolvedValueOnce(
        jsonResponse(200, { user: { accessToken: 'tok-4' }, serverSettings: {} }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    const fetcher = createAbsEbookFetcher(server, 'item-1');

    const res = await fetcher('ignored://placeholder', { headers: { Range: 'bytes=0-1023' } });

    expect(res.status).toBe(401);
    expect(fetchMock.mock.calls[2]![0]).toBe('http://abs.local:13378/login');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
