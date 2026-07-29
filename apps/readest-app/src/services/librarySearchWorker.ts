import { findFuzzyMatches } from '@/utils/fuzzySearch';
import { findNearbyMatches } from '@/utils/nearbySearch';
import type {
  LibrarySearchWorkerRequest,
  LibrarySearchWorkerResponse,
  LibrarySearchWorkerResult,
} from '@/utils/librarySearchWorkerProtocol';

type SearchPayload = Omit<LibrarySearchWorkerRequest['payload'], 'id'>;

const abortError = () => new DOMException('Library search aborted', 'AbortError');

export const createLibrarySearchWorker = () => {
  let worker: Worker | null = null;
  let nextId = 0;
  const pending = new Map<
    number,
    {
      resolve: (result: LibrarySearchWorkerResult) => void;
      reject: (error: Error) => void;
      signal?: AbortSignal;
      onAbort?: () => void;
    }
  >();

  const cleanupRequest = (id: number) => {
    const request = pending.get(id);
    if (!request) return null;
    if (request.signal && request.onAbort) {
      request.signal.removeEventListener('abort', request.onAbort);
    }
    pending.delete(id);
    return request;
  };

  const terminateWorker = () => {
    worker?.terminate();
    worker = null;
  };

  const failWorker = (message: string) => {
    terminateWorker();
    for (const id of [...pending.keys()]) cleanupRequest(id)?.reject(new Error(message));
  };

  const getWorker = () => {
    if (worker) return worker;
    worker = new Worker('/workers/library-search.worker.js', { type: 'module' });
    worker.onmessage = (event: MessageEvent<LibrarySearchWorkerResponse>) => {
      const request = cleanupRequest(event.data.id);
      if (!request) return;
      if (event.data.type === 'success') {
        request.resolve({ matches: event.data.matches, truncated: event.data.truncated });
      } else {
        const error = new Error(event.data.message);
        if (event.data.code) Object.assign(error, { code: event.data.code });
        request.reject(error);
      }
    };
    worker.onerror = (event) => failWorker(event.message || 'Library search worker failed');
    worker.onmessageerror = () => failWorker('Library search worker response was invalid');
    return worker;
  };

  const searchOnMainThread = (payload: SearchPayload): LibrarySearchWorkerResult => {
    const state: { truncated?: boolean } = {};
    const matches =
      payload.mode === 'fuzzy'
        ? findFuzzyMatches(payload.text, payload.query, payload.fuzzyOptions, payload.limit, state)
        : findNearbyMatches(
            payload.text,
            payload.query,
            payload.nearbyOptions,
            undefined,
            payload.limit,
            state,
          );
    return { matches, truncated: Boolean(state.truncated) };
  };

  return {
    async search(payload: SearchPayload, signal?: AbortSignal) {
      if (signal?.aborted) throw abortError();
      if (typeof Worker === 'undefined') return searchOnMainThread(payload);

      const id = nextId++;
      return await new Promise<LibrarySearchWorkerResult>((resolve, reject) => {
        const onAbort = () => {
          cleanupRequest(id);
          reject(abortError());
          if (pending.size === 0) terminateWorker();
        };
        pending.set(id, { resolve, reject, signal, onAbort });
        signal?.addEventListener('abort', onAbort, { once: true });
        const request: LibrarySearchWorkerRequest = { type: 'search', payload: { ...payload, id } };
        try {
          getWorker().postMessage(request);
        } catch (error) {
          cleanupRequest(id);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },
    close() {
      failWorker('Library search worker closed');
    },
  };
};
