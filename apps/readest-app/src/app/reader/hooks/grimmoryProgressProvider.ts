import { useBookDataStore } from '@/store/bookDataStore';
import { FIXED_LAYOUT_FORMATS } from '@/types/book';
import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
import { resolveGrimmoryBook } from '@/services/grimmory/bookMatch';
import { GrimmoryClient, grimmoryAccountKey } from '@/services/grimmory/GrimmoryClient';
import { GrimmorySyncStore } from '@/services/grimmory/GrimmorySyncStore';
import { grimmoryProgressBody, grimmoryRemoteProgress } from '@/services/grimmory/progress';
import type { KosyncEngineConfig, KosyncProgressProvider, ProgressSyncClient } from './useKOSync';

const createGrimmoryProgressClient = (
  config: KosyncEngineConfig,
  appService: AppService,
): ProgressSyncClient => {
  const connection = { ...config, password: config.password ?? '' };
  const client = new GrimmoryClient(connection);
  const store = new GrimmorySyncStore(appService);
  const account = grimmoryAccountKey(connection);
  const resolve = (book: Book) =>
    resolveGrimmoryBook({
      client,
      store,
      account,
      hash: book.hash,
      fileSize: useBookDataStore.getState().getBookData(book.hash)?.file?.size,
    });

  return {
    getDocumentDigest: (book) => book.hash,
    async getProgress(book) {
      try {
        const match = await resolve(book);
        if (!match) return null;
        const remote = await client.getBook(match.bookId);
        return grimmoryRemoteProgress(remote, FIXED_LAYOUT_FORMATS.has(book.format));
      } catch (error) {
        console.warn('[Grimmory] Failed to get progress', error);
        return null;
      }
    },
    async updateProgress(book, progress, percentage) {
      try {
        const match = await resolve(book);
        if (!match) return false;
        await client.updateProgress(grimmoryProgressBody(match, progress, percentage));
        return true;
      } catch (error) {
        console.warn('[Grimmory] Failed to update progress', error);
        return false;
      }
    },
  };
};

/**
 * Drives the progress sync hook against Grimmory's own progress API, in the
 * EPUB CFIs its foliate-based web reader reads and writes.
 */
export const grimmoryProgressProvider: KosyncProgressProvider = {
  name: 'grimmory',
  positions: 'cfi',
  createClient: createGrimmoryProgressClient,
  selectConfig: (settings) => {
    const grimmory = settings.grimmory;
    if (
      !grimmory.enabled ||
      !grimmory.syncProgress ||
      !grimmory.serverUrl ||
      !grimmory.username ||
      !grimmory.password
    ) {
      return null;
    }
    return {
      enabled: true,
      serverUrl: grimmory.serverUrl,
      username: grimmory.username,
      userkey: '',
      password: grimmory.password,
      // Grimmory records no device.
      deviceId: '',
      deviceName: '',
      checksumMethod: 'binary',
      strategy: grimmory.strategy,
      customHeaders: grimmory.customHeaders,
      allowSelfSignedCert: grimmory.allowSelfSignedCert,
    };
  },
};
