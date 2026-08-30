// @vitest-environment node

import { createWorker, OEM } from 'tesseract.js';
import { describe, expect, it } from 'vitest';

import { fetchVerifiedModelAsset } from '@/app/reader/services/manga/modelAssets';
import { getTesseractLanguageAsset } from '@/app/reader/services/ocr/tesseractLanguageAssets';

describe('Tesseract Lang[] worker integration', () => {
  it.skipIf(process.env['RUN_TESSERACT_REAL_WORKER_TESTS'] !== '1')(
    'initializes one real worker with verified jpn and jpn_vert byte assets',
    async () => {
      const languages = await Promise.all(
        ['jpn', 'jpn_vert'].map(async (code) => {
          const asset = getTesseractLanguageAsset(code);
          const buffer = await fetchVerifiedModelAsset(asset);
          return { code, data: new Uint8Array(buffer) };
        }),
      );

      const worker = await createWorker(languages, OEM.LSTM_ONLY, {
        cacheMethod: 'none',
        gzip: false,
        logger: () => undefined,
        errorHandler: () => undefined,
      });
      const { data } = await worker.recognize(
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          'base64',
        ),
        {},
        { text: true },
      );
      expect(data.text).toEqual(expect.any(String));
      await worker.terminate();
    },
    120_000,
  );
});
