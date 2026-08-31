import { pipeline } from '@huggingface/transformers';

import {
  type OpusTranslationRequest,
  type OpusTranslationResponse,
  OPUS_TRANSLATION_MODEL_ID,
  OPUS_TRANSLATION_MODEL_REVISION,
} from '@/app/reader/services/manga/opusTranslationProtocol';

const worker = self as unknown as DedicatedWorkerGlobalScope;

const translator = pipeline('translation', OPUS_TRANSLATION_MODEL_ID, {
  dtype: 'q8',
  revision: OPUS_TRANSLATION_MODEL_REVISION,
  progress_callback: (event) => {
    if (event.status !== 'progress') return;
    worker.postMessage({
      type: 'progress',
      progress: event.progress / 100,
    } satisfies OpusTranslationResponse);
  },
});

const translate = async (text: string): Promise<string> => {
  const run = await translator;
  const result = await run(text);
  const first = Array.isArray(result) ? result[0] : undefined;
  return first && 'translation_text' in first && typeof first.translation_text === 'string'
    ? first.translation_text
    : '';
};

let queue = Promise.resolve();

worker.onmessage = ({ data }: MessageEvent<OpusTranslationRequest>) => {
  if (data.type !== 'translate') return;
  queue = queue.then(async () => {
    try {
      const translations: string[] = [];
      for (const text of data.texts) translations.push(await translate(text));
      worker.postMessage({
        type: 'result',
        id: data.id,
        translations,
      } satisfies OpusTranslationResponse);
    } catch (error) {
      worker.postMessage({
        type: 'error',
        id: data.id,
        message: error instanceof Error ? error.message : String(error),
      } satisfies OpusTranslationResponse);
    }
  });
};
