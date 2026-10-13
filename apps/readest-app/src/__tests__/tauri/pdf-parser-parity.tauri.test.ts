import { describe, expect, it } from 'vitest';
import { parsePDFMetadata } from 'foliate-js/pdf.js';
import { DocumentLoader, type BookMetadata } from '@/libs/document';
import { partialMD5 } from '@/utils/md5';
import { invoke } from './tauri-invoke';

const CWD = process.env['CWD'] as string;
const PDF_FIXTURES = ['sample-alice.pdf', 'sample-metadata.pdf', 'sample-paper.pdf'] as const;

interface RustParsedPdfMetadata {
  partialMd5: string;
  info: {
    title?: number[] | Uint8Array | null;
    author?: number[] | Uint8Array | null;
    subject?: number[] | Uint8Array | null;
  };
  xmp?: number[] | Uint8Array | null;
}

const diskPath = (name: string): string => `${CWD}/src/__tests__/fixtures/data/${name}`;
const fixtureUrl = (name: string): string =>
  new URL(`../fixtures/data/${name}`, import.meta.url).href;

type PdfBookMetadata = BookMetadata & {
  contributor?: unknown;
  source?: string;
  rights?: string;
};

const fields = (metadata: BookMetadata): unknown => {
  const pdf = metadata as PdfBookMetadata;
  return {
    title: pdf.title,
    author: pdf.author,
    contributor: pdf.contributor,
    description: pdf.description,
    language: pdf.language,
    publisher: pdf.publisher,
    subject: pdf.subject,
    identifier: pdf.identifier,
    source: pdf.source,
    rights: pdf.rights,
    belongsTo: pdf.belongsTo,
  };
};

describe('parse_pdf_metadata parity with the foliate-js PDF reader', () => {
  for (const name of PDF_FIXTURES) {
    it(`returns raw inputs that normalize identically: ${name}`, async () => {
      const buffer = await (await fetch(fixtureUrl(name))).arrayBuffer();
      const file = new File([buffer], name, { type: 'application/pdf' });
      const rust = (await invoke('parse_pdf_metadata', {
        filePath: diskPath(name),
      })) as RustParsedPdfMetadata;

      const loader = new DocumentLoader(file);
      const js = await loader.open();
      try {
        expect(rust.partialMd5).toBe(await partialMD5(file));
        expect(fields(parsePDFMetadata(rust))).toEqual(fields(js.book.metadata));
      } finally {
        await js.book.destroy?.();
      }
    });
  }
});
