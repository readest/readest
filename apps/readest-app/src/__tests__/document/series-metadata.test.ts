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

const makeCbzFixture = async ({
  comicInfo,
  comicInfoPath = 'ComicInfo.xml',
  imageCount,
}: {
  comicInfo?: string;
  comicInfoPath?: string;
  imageCount: number;
}): Promise<File> => {
  const { BlobWriter, TextReader, ZipWriter } = await import('@zip.js/zip.js');
  const writer = new ZipWriter(new BlobWriter('application/vnd.comicbook+zip'));
  for (let i = 0; i < imageCount; i++) {
    await writer.add(`${i}.png`, new TextReader(`image-${i}`));
  }
  if (comicInfo) {
    await writer.add(comicInfoPath, new TextReader(comicInfo));
  }
  const blob = await writer.close();
  return new File([blob], 'page-count.cbz', { type: 'application/vnd.comicbook+zip' });
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

  describe('FB2 (title-info sequence)', () => {
    let book: BookDoc;

    beforeAll(async () => {
      book = await loadFixture('sample-metadata.fb2', 'application/x-fictionbook+xml', 'FB2');
    });

    it('extracts series name and position from the sequence element', () => {
      const series = getSeries(book);
      expect(series).toBeTruthy();
      expect(series!.name).toBe('Metadata Series');
      expect(series!.position).toBe('3');
    });

    it('preserves the title', () => {
      expect(book.metadata.title).toBe('FB2 Metadata');
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

    it('extracts displayable ComicInfo.xml schema fields from nested archives', async () => {
      const file = await makeCbzFixture({
        imageCount: 3,
        comicInfoPath: 'metadata/ComicInfo.xml',
        comicInfo: `<?xml version="1.0" encoding="utf-8"?>
<ComicInfo xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Title>Example Title</Title>
  <Series>Example Series</Series>
  <Volume>1</Volume>
  <Number>1</Number>
  <Count>5</Count>
  <Summary>Example Summary</Summary>
  <Writer>Example Author</Writer>
  <Genre>Example Genre</Genre>
  <Year>2025</Year>
  <Month>12</Month>
  <Web>https://www.google.com/</Web>
  <Manga>Yes</Manga>
  <LanguageISO>en</LanguageISO>
  <Translator>Example Translator</Translator>
  <PageCount>20</PageCount>
</ComicInfo>`,
      });
      const loader = new DocumentLoader(file);
      const result = await loader.open();

      expect(result.book.metadata).toMatchObject({
        title: 'Example Title',
        author: 'Example Author',
        language: 'en',
        description: 'Example Summary',
        publisher: undefined,
        published: '2025-12',
        identifier: 'https://www.google.com/',
        subject: ['Example Genre'],
      });
      const series = getSeries(result.book);
      expect(series).toMatchObject({ name: 'Example Series', position: '1', total: '5' });
    });
  });
});
