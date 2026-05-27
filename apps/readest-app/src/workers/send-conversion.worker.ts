import { convertToEpub } from '../services/send/conversion/convertToEpub';
import { ConversionError } from '../services/send/conversion/types';
import {
  ConversionWorkerRequest,
  ConversionWorkerResponse,
} from '../services/send/conversion/conversion-worker-protocol';

// Document conversion (mammoth DOCX parsing, Readability, EPUB zip assembly) is
// CPU-heavy; running it here keeps the UI thread responsive.
const workerContext: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

workerContext.onmessage = async (event: MessageEvent<ConversionWorkerRequest>) => {
  if (event.data.type !== 'convert') return;

  try {
    const book = await convertToEpub(event.data.payload);
    const epubBuffer = await book.file.arrayBuffer();
    const response: ConversionWorkerResponse = {
      type: 'success',
      payload: {
        epubBuffer,
        name: book.file.name,
        title: book.title,
        author: book.author,
      },
    };
    workerContext.postMessage(response, [epubBuffer]);
  } catch (error) {
    const response: ConversionWorkerResponse = {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : String(error),
        code: error instanceof ConversionError ? error.code : undefined,
      },
    };
    workerContext.postMessage(response);
  }
};
