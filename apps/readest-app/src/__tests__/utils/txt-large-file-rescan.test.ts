import { describe, it, expect, vi } from 'vitest';
import { TxtToEpubConverter } from '@/utils/txt';

type FlowAPI = {
  convert(options: { file: File }): Promise<{ chapterCount: number }>;
  extractChaptersFromFileBySegments: (...args: unknown[]) => Promise<unknown>;
  probeChapterCountFromFileBySegments: (...args: unknown[]) => Promise<number>;
  createEpub: (...args: unknown[]) => Promise<Blob>;
};

/**
 * Large TXT path (>8 MiB): when the first segment pass finds ≤1 chapter, the
 * converter re-reads the file for a probe pass and again for a second extract.
 * That is a real multi-pass cost on the same ClosableFile/stream — preserved
 * here as an observable mechanism, not a memory-G claim.
 */
describe('TxtToEpubConverter large-file re-scan mechanism', () => {
  it('re-reads the file up to three times when only one chapter is found', async () => {
    const converter = new TxtToEpubConverter() as unknown as FlowAPI;
    const extractSpy = vi.spyOn(converter, 'extractChaptersFromFileBySegments');
    const probeSpy = vi.spyOn(converter, 'probeChapterCountFromFileBySegments');
    converter.createEpub = vi.fn(async () => new Blob(['epub']));

    // No chapter headings → paragraph fallback yields chapters, but the first
    // extract can still return a single merged/fallback chapter depending on
    // segment layout. Force the ≤1 branch by stubbing the first extract.
    const oneChapter = [
      { title: '1', content: '<h2>1</h2><p>body</p>', isVolume: false, detected: false },
    ];
    const manyChapters = [
      { title: '1', content: '<h2>1</h2><p>a</p>', isVolume: false, detected: false },
      { title: '2', content: '<h2>2</h2><p>b</p>', isVolume: false, detected: false },
    ];

    extractSpy.mockResolvedValueOnce(oneChapter).mockResolvedValueOnce(manyChapters);
    probeSpy.mockResolvedValue(2);

    const size = 9 * 1024 * 1024;
    const file = new File([new Uint8Array(size)], 'big.txt', { type: 'text/plain' });

    const result = await converter.convert({ file });

    expect(extractSpy).toHaveBeenCalledTimes(2);
    expect(probeSpy).toHaveBeenCalledTimes(1);
    expect(result.chapterCount).toBe(2);
  });
});
