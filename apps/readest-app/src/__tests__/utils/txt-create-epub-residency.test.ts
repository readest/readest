import { describe, it, expect, vi } from 'vitest';
import { TxtToEpubConverter } from '@/utils/txt';

type Chapter = {
  title: string;
  content: string;
  isVolume: boolean;
};

type CreateEpubAPI = {
  createEpub(
    chapters: Chapter[],
    metadata: {
      bookTitle: string;
      author: string;
      language: string;
      identifier: string;
    },
  ): Promise<Blob>;
};

/**
 * While building the in-memory EPUB, createEpub must release each chapter's
 * HTML body after that entry is written into the zip. Otherwise import keeps
 * the full chapter HTML array live alongside ZipWriter/BlobWriter buffers —
 * the residency that grows with book size during folder TXT import (#5601 /
 * same "cleanup after use" contract as #5439's destroy/close).
 */
describe('TxtToEpubConverter createEpub chapter body residency', () => {
  it('clears each chapter.content after the chapter entry is added', async () => {
    const converter = new TxtToEpubConverter() as unknown as CreateEpubAPI;
    const chapters: Chapter[] = [
      { title: 'One', content: '<h2>One</h2><p>' + '甲'.repeat(2000) + '</p>', isVolume: false },
      { title: 'Two', content: '<h2>Two</h2><p>' + '乙'.repeat(2000) + '</p>', isVolume: false },
      {
        title: 'Three',
        content: '<h2>Three</h2><p>' + '丙'.repeat(2000) + '</p>',
        isVolume: false,
      },
    ];
    const contentSnapshots: string[] = [];

    const zipJs = await import('@zip.js/zip.js');
    const originalAdd = zipJs.ZipWriter.prototype.add;
    const addSpy = vi.spyOn(zipJs.ZipWriter.prototype, 'add').mockImplementation(async function (
      this: unknown,
      name: string,
      ...args: unknown[]
    ) {
      const result = await originalAdd.apply(this, [name, ...args] as never);
      if (typeof name === 'string' && name.startsWith('OEBPS/chapter')) {
        contentSnapshots.push(chapters.map((c) => c.content).join('|'));
      }
      return result;
    });

    try {
      const blob = await converter.createEpub(chapters, {
        bookTitle: 'Residency',
        author: 'Test',
        language: 'zh',
        identifier: 'id-residency',
      });

      expect(blob.size).toBeGreaterThan(0);
      expect(addSpy.mock.calls.some((c) => String(c[0]).startsWith('OEBPS/chapter'))).toBe(true);

      // After chapter N is added, chapters[0..N-1] content must already be
      // released; later chapters may still hold HTML until their turn.
      expect(contentSnapshots).toHaveLength(3);
      expect(contentSnapshots[0]!.startsWith('|')).toBe(true);
      expect(contentSnapshots[0]!).not.toContain('甲'.repeat(20));
      expect(contentSnapshots[0]!).toContain('乙'.repeat(20));
      expect(contentSnapshots[1]!).not.toContain('乙'.repeat(20));
      expect(contentSnapshots[1]!).toContain('丙'.repeat(20));
      expect(contentSnapshots[2]).toBe('||');
      expect(chapters.every((c) => c.content === '')).toBe(true);
    } finally {
      addSpy.mockRestore();
    }
  });
});
