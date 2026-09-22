import { expect, it } from 'vitest';
import { decodeMangaText } from '@/app/reader/services/ocr/mangaOcrDecode';

it('keeps a better sentence even when its first character loses greedy decoding', async () => {
  const result = await decodeMangaText(async (sequences) => {
    const logits = new Float32Array(sequences.length * 6144).fill(-100);
    for (const [index, tokens] of sequences.entries()) {
      const offset = index * 6144;
      if (tokens.length === 1) {
        logits[offset + 5] = 1;
        logits[offset + 6] = 0.9;
      } else if (tokens[1] === 6) {
        logits[offset + 3] = 10;
      } else {
        for (let token = 0; token < 6144; token++) logits[offset + token] = 0;
      }
    }
    return logits;
  });
  expect(result.tokens).toEqual([6]);
  expect(result.confidence).toBeGreaterThan(50);
});

it('blocks repeated trigrams and stops cancelled decoding', async () => {
  const result = await decodeMangaText(async (sequences) => {
    const logits = new Float32Array(sequences.length * 6144).fill(-100);
    for (let i = 0; i < sequences.length; i++) {
      logits[i * 6144 + 5] = 10;
      logits[i * 6144 + 3] = 9;
    }
    return logits;
  });
  expect(result.tokens).toEqual([5, 5, 5]);
  await expect(
    decodeMangaText(async () => new Float32Array(), AbortSignal.abort()),
  ).rejects.toThrow();
});
