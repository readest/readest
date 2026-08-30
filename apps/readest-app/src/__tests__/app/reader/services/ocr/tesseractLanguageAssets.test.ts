import { describe, expect, it } from 'vitest';

import {
  OCR_LANGUAGE_CODES,
  getTesseractLanguages,
} from '@/app/reader/services/ocr/tesseractLanguages';
import {
  getTesseractLanguageAsset,
  TESSERACT_LANGUAGE_ASSETS,
} from '@/app/reader/services/ocr/tesseractLanguageAssets';

describe('Tesseract language assets', () => {
  it('covers every language exposed by OCR settings with pinned assets', () => {
    const modelCodes = new Set(
      OCR_LANGUAGE_CODES.flatMap((language) => getTesseractLanguages(language)),
    );

    expect(modelCodes).toEqual(new Set(TESSERACT_LANGUAGE_ASSETS.map((asset) => asset.code)));
    for (const asset of TESSERACT_LANGUAGE_ASSETS) {
      expect(asset.sha256).toMatch(/^[a-f\d]{64}$/iu);
      expect(asset.compressedSha256).toMatch(/^[a-f\d]{64}$/iu);
      expect(asset.maximumDownloadBytes).toBeGreaterThan(0);
      expect(asset.maximumResultBytes).toBeGreaterThan(0);
      expect(asset.url).toContain('@1.0.0/4.0.0_best_int/');
      expect(getTesseractLanguageAsset(asset.code)).toBe(asset);
    }
  });

  it.skipIf(process.env['RUN_TESSERACT_LIVE_ASSET_TESTS'] !== '1')(
    'checks the live eng, jpn, and jpn_vert assets against their manifest hashes',
    async () => {
      const { fetchVerifiedModelAsset } = await import('@/app/reader/services/manga/modelAssets');

      for (const code of ['eng', 'jpn', 'jpn_vert']) {
        const asset = getTesseractLanguageAsset(code);
        const result = await fetchVerifiedModelAsset(asset);
        expect(result.byteLength).toBe(asset.maximumResultBytes);
      }
    },
  );
});
