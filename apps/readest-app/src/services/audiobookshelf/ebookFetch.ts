import environmentConfig from '@/services/environment';
import { absFetch } from '@/services/audiobookshelf/client';
import { createAbsClient } from '@/services/audiobookshelf/createClient';
import { findABSServerById } from '@/store/absServerStore';
import type { ABSServer } from '@/types/audiobookshelf';
import { buildAbsEbookUrl } from '@/utils/audiobook';

/**
 * Range-request fetcher for an ebook streamed from an Audiobookshelf item
 * (`/api/items/:id/ebook`), to hand to a `RemoteFile`.
 *
 * ABS >= 2.26 access tokens are short-lived (an hour on some servers), and the
 * reader keeps one RemoteFile per book for as long as the book stays open, so a
 * URL with the token baked in at open time starts answering 401 on every
 * not-yet-cached section read once the token expires. Like the audio path's
 * `resolveUrl` (openAudiobook.ts), this reads the store's CURRENT token on every
 * request — so a rotation by the periodic library sync is picked up — and on a
 * 401 refreshes / re-logs in through a persisting client and retries once.
 */
export const createAbsEbookFetcher = (server: ABSServer, itemId: string): typeof fetch => {
  const liveServer = () => findABSServerById(server.id) ?? server;
  const read = (init?: RequestInit) =>
    absFetch(buildAbsEbookUrl(liveServer(), itemId), {
      method: init?.method,
      headers: Object.fromEntries(new Headers(init?.headers)),
    });
  return async (_input, init) => {
    const res = await read(init);
    if (res.status !== 401) return res;
    const appService = await environmentConfig.getAppService();
    await createAbsClient(appService, liveServer()).refreshOrRelogin();
    return read(init);
  };
};
