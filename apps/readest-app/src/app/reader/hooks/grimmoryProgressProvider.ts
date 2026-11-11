import { useBookDataStore } from '@/store/bookDataStore';
import { FIXED_LAYOUT_FORMATS } from '@/types/book';
import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
import { resolveGrimmoryBook } from '@/services/grimmory/bookMatch';
import {
  GrimmoryClient,
  GrimmoryRequestError,
  grimmoryAccountKey,
} from '@/services/grimmory/GrimmoryClient';
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
  const progressClient: ProgressSyncClient = {
    lastError: null,
    getDocumentDigest: (book) => book.hash,
    async getProgress(book) {
      progressClient.lastError = null;
      try {
        const match = await resolve(book);
        if (!match) return null;
        const remote = await client.getBook(match.bookId);
        return grimmoryRemoteProgress(remote, FIXED_LAYOUT_FORMATS.has(book.format));
      } catch (error) {
        console.warn('[Grimmory] Failed to get progress', error);
        await noteFailure(book, error);
        return null;
      }
    },
    async updateProgress(book, progress, percentage) {
      progressClient.lastError = null;
      try {
        const match = await resolve(book);
        if (!match) return false;
        await client.updateProgress(grimmoryProgressBody(match, progress, percentage));
        return true;
      } catch (error) {
        console.warn('[Grimmory] Failed to update progress', error);
        await noteFailure(book, error);
        return false;
      }
    },
  };
  // A book removed from Grimmory isn't a failed sync: forget it so the next
  // call looks again.
  const noteFailure = async (book: Book, error: unknown) => {
    if (error instanceof GrimmoryRequestError && error.status === 404) {
      await store.deleteBook(account, book.hash).catch(() => undefined);
      return;
    }
    progressClient.lastError = error instanceof Error ? error.message : String(error);
  };
  return progressClient;
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
