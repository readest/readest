import { describe, expect, it } from 'vitest';

import {
  COMIC_TEXT_DETECTOR_INPUT_SIZE,
  COMIC_TEXT_DETECTOR_MODEL_ASSET,
  COMIC_TEXT_DETECTOR_MODEL_SHA256,
  COMIC_TEXT_DETECTOR_MODEL_URL,
  extractComicLinePolygons,
  postprocessComicDetectorOutputs,
} from '@/app/reader/services/manga/comicTextDetector';

const fillRectangle = (
  data: Float32Array,
  left: number,
  top: number,
  right: number,
  bottom: number,
) => {
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      data[y * COMIC_TEXT_DETECTOR_INPUT_SIZE + x] = 0.9;
    }
  }
};

describe('Comic text detection', () => {
  it('keeps an uneven text component in its minimum enclosing rectangle', () => {
    const lines = new Float32Array(1024 * 1024);
    fillRectangle(lines, 100, 100, 120, 160);
    fillRectangle(lines, 100, 100, 140, 110);

    const [line] = extractComicLinePolygons(lines, { width: 1024, height: 1024 });

    expect(line?.vertical).toBe(true);
    expect(line?.box).toEqual({ xMin: 82, yMin: 82, xMax: 157, yMax: 177 });
  });

  it('maps the pinned detector output to ordered Japanese text lines', () => {
    expect(COMIC_TEXT_DETECTOR_MODEL_ASSET).toMatchObject({
      url: COMIC_TEXT_DETECTOR_MODEL_URL,
      sha256: COMIC_TEXT_DETECTOR_MODEL_SHA256,
    });

    const blocks = new Float32Array(64_512 * 7);
    const segmentation = new Float32Array(1024 * 1024);
    const lines = new Float32Array(2 * 1024 * 1024);
    blocks.set([512, 400, 240, 120, 0.95, 0.05, 0.95]);
    fillRectangle(segmentation, 392, 340, 632, 460);
    fillRectangle(lines, 420, 360, 600, 420);

    const result = postprocessComicDetectorOutputs(
      {
        blk: { dims: [1, 64_512, 7], data: blocks },
        seg: { dims: [1, 1, 1024, 1024], data: segmentation },
        det: { dims: [1, 2, 1024, 1024], data: lines },
      },
      { width: 1024, height: 1024 },
    );

    expect(result.blocks).toEqual([
      expect.objectContaining({
        language: 'ja',
        lines: [expect.objectContaining({ vertical: false })],
      }),
    ]);
  });
});
