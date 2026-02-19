import { TxtToEpubConverter } from './txt';
import { getOSPlatform } from './misc';
import { TxtConverterWorkerRequest, TxtConverterWorkerResponse } from './txt-worker-protocol';

interface ConvertTxtToEpubOptions {
  file: File;
  author?: string;
  language?: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const LARGE_TXT_WORKER_BYPASS_BYTES = 16 * 1024 * 1024;

const convertTxtToEpubOnMainThread = async (options: ConvertTxtToEpubOptions) => {
  const converter = new TxtToEpubConverter();
  return converter.convert(options);
};

const convertTxtToEpubInWorker = async (options: ConvertTxtToEpubOptions) => {
  if (typeof Worker === 'undefined') {
    throw new Error('Worker is not supported in current environment');
  }

  const { file, author, language, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  return await new Promise<Awaited<ReturnType<TxtToEpubConverter['convert']>>>(
    (resolve, reject) => {
      const worker = new Worker(new URL('../workers/txt-converter.worker.ts', import.meta.url), {
        type: 'module',
      });

      const cleanup = () => {
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
        worker.terminate();
      };

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`TXT conversion worker timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      worker.onmessage = (event: MessageEvent<TxtConverterWorkerResponse>) => {
        clearTimeout(timer);

        if (event.data.type === 'error') {
          cleanup();
          reject(new Error(event.data.payload.message));
          return;
        }

        const {
          epubBuffer,
          name,
          bookTitle,
          chapterCount,
          language: detectedLanguage,
        } = event.data.payload;
        cleanup();
        resolve({
          file: new File([epubBuffer], name, { type: 'application/epub+zip' }),
          bookTitle,
          chapterCount,
          language: detectedLanguage,
        });
      };

      worker.onerror = () => {
        clearTimeout(timer);
        cleanup();
        reject(new Error('TXT conversion worker failed'));
      };

      worker.onmessageerror = () => {
        clearTimeout(timer);
        cleanup();
        reject(new Error('TXT conversion worker message deserialization failed'));
      };

      const request: TxtConverterWorkerRequest = {
        type: 'convert',
        payload: {
          file,
          author,
          language,
        },
      };
      worker.postMessage(request);
    },
  );
};

export const convertTxtToEpubWithFallback = async (options: ConvertTxtToEpubOptions) => {
  const os = typeof navigator !== 'undefined' ? getOSPlatform() : 'unknown';
  const shouldBypassWorker =
    (os === 'ios' && options.file.size > LARGE_TXT_WORKER_BYPASS_BYTES) ||
    typeof Worker === 'undefined';
  if (shouldBypassWorker) {
    return await convertTxtToEpubOnMainThread(options);
  }

  try {
    return await convertTxtToEpubInWorker(options);
  } catch (error) {
    console.warn('TXT conversion worker failed, falling back to main thread:', error);
    return await convertTxtToEpubOnMainThread(options);
  }
};
