import { TxtToEpubConverter } from '../utils/txt';
import {
  TxtConverterWorkerRequest,
  TxtConverterWorkerResponse,
} from '../utils/txt-worker-protocol';

const workerContext: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

workerContext.onmessage = async (event: MessageEvent<TxtConverterWorkerRequest>) => {
  if (event.data.type !== 'convert') return;

  const { file, author, language } = event.data.payload;

  try {
    const converter = new TxtToEpubConverter();
    const result = await converter.convert({ file, author, language });
    const epubBuffer = await result.file.arrayBuffer();
    const response: TxtConverterWorkerResponse = {
      type: 'success',
      payload: {
        epubBuffer,
        name: result.file.name,
        bookTitle: result.bookTitle,
        chapterCount: result.chapterCount,
        language: result.language,
      },
    };
    workerContext.postMessage(response, [epubBuffer]);
  } catch (error) {
    const response: TxtConverterWorkerResponse = {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : String(error),
      },
    };
    workerContext.postMessage(response);
  }
};

export {};
