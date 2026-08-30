import { gunzip } from 'fflate';

export interface ModelDownloadProgress {
  loaded: number;
  total?: number;
}

export interface VerifiedModelAsset {
  url: string;
  sha256: string;
  compression?: 'gzip';
  maximumDownloadBytes: number;
  maximumResultBytes: number;
  signal?: AbortSignal;
  onProgress?: (progress: ModelDownloadProgress) => void;
}

interface ModelAssetDependencies {
  fetchImpl: typeof fetch;
  digestSha256: (data: Uint8Array) => Promise<string>;
  decompressGzip: (data: Uint8Array, signal?: AbortSignal) => Promise<Uint8Array>;
}

const abortError = (signal: AbortSignal): unknown =>
  signal.reason ?? new DOMException('The operation was aborted', 'AbortError');

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw abortError(signal);
};

const defaultDigestSha256 = async (data: Uint8Array): Promise<string> => {
  const input = Uint8Array.from(data).buffer;
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', input));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const defaultDecompressGzip = (data: Uint8Array, signal?: AbortSignal): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    try {
      throwIfAborted(signal);
    } catch (error) {
      reject(error);
      return;
    }

    let settled = false;
    const task = gunzip(data, { consume: true }, (error, result) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve(result);
    });
    const onAbort = () => {
      if (settled) return;
      settled = true;
      task();
      reject(abortError(signal!));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

const readDownload = async (
  response: Response,
  maximumBytes: number,
  onProgress?: (progress: ModelDownloadProgress) => void,
): Promise<Uint8Array> => {
  const lengthHeader = response.headers.get('content-length');
  const contentLength = lengthHeader === null ? undefined : Number(lengthHeader);
  const total = Number.isFinite(contentLength) && contentLength! >= 0 ? contentLength : undefined;
  if (total !== undefined && total > maximumBytes) {
    throw new Error(`Model download is larger than ${maximumBytes} bytes`);
  }

  if (!response.body) {
    const data = new Uint8Array(await response.arrayBuffer());
    if (data.byteLength > maximumBytes) {
      throw new Error(`Model download is larger than ${maximumBytes} bytes`);
    }
    onProgress?.({ loaded: data.byteLength, ...(total === undefined ? {} : { total }) });
    return data;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      loaded += value.byteLength;
      if (loaded > maximumBytes) {
        await reader.cancel();
        throw new Error(`Model download is larger than ${maximumBytes} bytes`);
      }
      chunks.push(value);
      onProgress?.({ loaded, ...(total === undefined ? {} : { total }) });
    }
  } finally {
    reader.releaseLock();
  }

  const data = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return data;
};

const getGzipResultSize = (data: Uint8Array): number => {
  if (data.byteLength < 8 || data[0] !== 0x1f || data[1] !== 0x8b) {
    throw new Error('Model download contains malformed gzip data');
  }
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(
    data.byteLength - 4,
    true,
  );
};

const validateLimit = (name: string, value: number): void => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
};

export const fetchVerifiedModelAsset = async (
  options: VerifiedModelAsset,
  dependencies: Partial<ModelAssetDependencies> = {},
): Promise<ArrayBuffer> => {
  validateLimit('maximumDownloadBytes', options.maximumDownloadBytes);
  validateLimit('maximumResultBytes', options.maximumResultBytes);
  if (!/^[a-f\d]{64}$/iu.test(options.sha256)) {
    throw new Error('Model asset SHA-256 must contain 64 hexadecimal characters');
  }
  throwIfAborted(options.signal);

  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch;
  const response = await fetchImpl(options.url, {
    cache: 'force-cache',
    credentials: 'omit',
    signal: options.signal,
  });
  if (!response.ok) {
    throw new Error(`Model download failed with HTTP ${response.status}`);
  }

  const downloaded = await readDownload(response, options.maximumDownloadBytes, options.onProgress);
  throwIfAborted(options.signal);

  let result = downloaded;
  if (options.compression === 'gzip') {
    const declaredSize = getGzipResultSize(downloaded);
    if (declaredSize > options.maximumResultBytes) {
      throw new Error(`Model gzip expands beyond ${options.maximumResultBytes} bytes`);
    }
    const decompress = dependencies.decompressGzip ?? defaultDecompressGzip;
    result = await decompress(downloaded, options.signal);
  }
  if (result.byteLength > options.maximumResultBytes) {
    throw new Error(`Model asset is larger than ${options.maximumResultBytes} bytes`);
  }
  throwIfAborted(options.signal);

  const digest = dependencies.digestSha256 ?? defaultDigestSha256;
  const actualSha256 = await digest(result);
  if (actualSha256.toLowerCase() !== options.sha256.toLowerCase()) {
    throw new Error('Model asset checksum does not match the pinned SHA-256');
  }

  return Uint8Array.from(result).buffer;
};
