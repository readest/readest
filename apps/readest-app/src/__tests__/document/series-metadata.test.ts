import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, join } from 'path';

import { DocumentLoader } from '@/libs/document';
import type { BookDoc } from '@/libs/document';
import type { Collection } from '@/utils/book';

const vendorDir = join(process.cwd(), 'public/vendor');

const loadFixture = async (
  filename: string,
  mimeType: string,
  expectedFormat: string,
): Promise<BookDoc> => {
  const filePath = resolve(__dirname, '../fixtures/data', filename);
  const buffer = readFileSync(filePath);
  const file = new File([buffer], filename, { type: mimeType });
  const loader = new DocumentLoader(file);
  const result = await loader.open();
  expect(result.format).toBe(expectedFormat);
  return result.book;
};

const getSeries = (book: BookDoc): Collection | undefined => {
  const belongsTo = book.metadata.belongsTo?.series;
  if (!belongsTo) return undefined;
  return Array.isArray(belongsTo) ? belongsTo[0] : belongsTo;
};

describe('Calibre series metadata', () => {
  describe('PDF (XMP calibre:series)', () => {
    let book: BookDoc;

    beforeAll(async () => {
      await import('foliate-js/pdf.js');
      const pdfjsLib = (globalThis as Record<string, unknown>)['pdfjsLib'] as {
        GlobalWorkerOptions: { workerSrc: string };
      };
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        `file://${join(vendorDir, 'pdfjs/pdf.worker.min.mjs')}`,
      ).href;

      book = await loadFixture('sample-metadata.pdf', 'application/pdf', 'PDF');
    }, 30_000);

    it('extracts series name and position from XMP', () => {
      const series = getSeries(book);
      expect(series).toBeTruthy();
      expect(series!.name).toBe('Metadata Series');
      expect(series!.position).toBe('1.00');
    });

    it('preserves the title', () => {
      expect(book.metadata.title).toBe('PDF Metadata');
    });
  });

  describe('CBZ (ComicInfo.xml + ComicBookInfo)', () => {
    let book: BookDoc;

    beforeAll(async () => {
      book = await loadFixture('sample-metadata.cbz', 'application/vnd.comicbook+zip', 'CBZ');
    });

    it('extracts series name and position', () => {
      const series = getSeries(book);
      expect(series).toBeTruthy();
      expect(series!.name).toBe('Metadata Series');
      expect(series!.position).toBe('2.0');
    });

    it('preserves the title', () => {
      expect(book.metadata.title).toBe('CBZ Metadata');
    });
  });
});
