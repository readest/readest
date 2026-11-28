export interface ModelAsset {
  url: string;
  /** The SHA-256 of the file, once unpacked. */
  sha256: string;
  /** The size of the file, once unpacked. */
  bytes: number;
  gzip?: boolean;
}

export interface ModelLoadOptions {
  signal?: AbortSignal;
  /** The bytes read so far, once unpacked. */
  onProgress?: (loaded: number) => void;
}

const MODEL_CACHE = 'readest-ocr-models';
// The web app's service worker keeps every file it fetches in this cache.
const SERVICE_WORKER_CACHE = 'offline-cache';

const findModel = async (url: string): Promise<Response | undefined> => {
  try {
    return await globalThis.caches?.match(url);
  } catch {
    return undefined;
  }
};

/**
 * Keeps a model for the next time it's needed. The browser's own cache can't: it
 * skips files this large, and the model host redirects to a URL signed per
 * request.
 */
const keepModel = async (url: string, response: Response): Promise<void> => {
  const cache = await caches.open(MODEL_CACHE);
  await cache.put(url, response);
};

const fetchModel = async (url: string, signal?: AbortSignal): Promise<Response> => {
  const cache = globalThis.caches ? 'no-store' : 'force-cache';
  const response = await fetch(url, { cache, credentials: 'omit', signal });
  if (!response.ok) throw new Error(`Model download failed with HTTP ${response.status}`);
  if (globalThis.caches && !(await caches.has(SERVICE_WORKER_CACHE).catch(() => true))) {
    keepModel(url, response.clone()).catch((error) => console.warn('Model was not kept', error));
  }
  return response;
};

/** Reads the model into one buffer of its known size, unpacking it as it arrives. */
const readModel = async (
  response: Response,
  { sha256, bytes, gzip }: ModelAsset,
  { signal, onProgress }: ModelLoadOptions,
): Promise<ArrayBuffer> => {
  let stream: ReadableStream<Uint8Array<ArrayBuffer>> = response.body!;
  if (gzip) stream = stream.pipeThrough(new DecompressionStream('gzip'));
  const data = new Uint8Array(bytes);
  let loaded = 0;
  for (const reader = stream.getReader(); ; ) {
    const { done, value } = await reader.read();
    signal?.throwIfAborted();
    if (done) break;
    if (loaded + value.byteLength > bytes) {
      await reader.cancel();
      throw new Error(`Model is larger than ${bytes} bytes`);
    }
    data.set(value, loaded);
    loaded += value.byteLength;
    onProgress?.(loaded);
  }
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  signal?.throwIfAborted();
  const actual = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
  if (loaded !== bytes || actual !== sha256) {
    throw new Error('Model checksum does not match the pinned SHA-256');
  }
  return data.buffer;
};

export const loadModelAsset = async (
  asset: ModelAsset,
  options: ModelLoadOptions = {},
): Promise<ArrayBuffer> => {
  options.signal?.throwIfAborted();
  const kept = await findModel(asset.url);
  if (kept) {
    try {
      return await readModel(kept, asset, options);
    } catch {
      // Download it again, over the copy that can't be used.
      options.signal?.throwIfAborted();
    }
  }
  return readModel(await fetchModel(asset.url, options.signal), asset, options);
};
