import { convertToEpub, type ConvertInput } from './convertToEpub';
import type { ConvertedBook } from './types';
import type {
  ConversionWorkerRequest,
  ConversionWorkerResponse,
} from './conversion-worker-protocol';

const DEFAULT_TIMEOUT_MS = 120_000;

async function convertInWorker(input: ConvertInput, timeoutMs: number): Promise<ConvertedBook> {
  return await new Promise<ConvertedBook>((resolve, reject) => {
    const worker = new Worker(
      new URL('../../../workers/send-conversion.worker.ts', import.meta.url),
      {
        type: 'module',
      },
    );

    const cleanup = () => {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Conversion worker timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    worker.onmessage = (event: MessageEvent<ConversionWorkerResponse>) => {
      clearTimeout(timer);
      if (event.data.type === 'error') {
        cleanup();
        reject(new Error(event.data.payload.message));
        return;
      }
      const { epubBuffer, name, title, author } = event.data.payload;
      cleanup();
      resolve({
        file: new File([epubBuffer], name, { type: 'application/epub+zip' }),
        title,
        author,
      });
    };

    worker.onerror = () => {
      clearTimeout(timer);
      cleanup();
      reject(new Error('Conversion worker failed'));
    };
    worker.onmessageerror = () => {
      clearTimeout(timer);
      cleanup();
      reject(new Error('Conversion worker message deserialization failed'));
    };

    const request: ConversionWorkerRequest = { type: 'convert', payload: input };
    worker.postMessage(request);
  });
}

/**
 * Convert a document to EPUB off the main thread, falling back to in-thread
 * conversion when Web Workers are unavailable or the worker fails.
 */
export async function convertToEpubWithWorker(
  input: ConvertInput,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<ConvertedBook> {
  if (typeof Worker === 'undefined') {
    return convertToEpub(input);
  }
  try {
    return await convertInWorker(input, timeoutMs);
  } catch (error) {
    console.warn('Conversion worker failed, falling back to main thread:', error);
    return convertToEpub(input);
  }
}

const CONVERTIBLE_EXT: Record<string, 'docx' | 'rtf' | 'html' | 'txt'> = {
  docx: 'docx',
  rtf: 'rtf',
  html: 'html',
  htm: 'html',
  txt: 'txt',
};

/**
 * If a file is a document Readest can't read natively, convert it to EPUB;
 * otherwise return it unchanged. Shared by the `/send` page and the inbox
 * drainer so both channels convert identically.
 */
export async function convertFileIfNeeded(file: File): Promise<File> {
  const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : '';
  const kind = CONVERTIBLE_EXT[ext];
  if (!kind) return file;
  if (kind === 'txt') {
    return (await convertToEpubWithWorker({ kind: 'txt', file })).file;
  }
  const bytes = await file.arrayBuffer();
  return (await convertToEpubWithWorker({ kind, bytes, fileName: file.name })).file;
}
