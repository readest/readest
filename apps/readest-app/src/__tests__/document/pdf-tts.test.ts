import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, join } from 'path';
import { textWalker } from 'foliate-js/text-walker.js';
import { TTS } from 'foliate-js/tts.js';
import { createRejectFilter } from '@/utils/node';
import { DocumentLoader } from '@/libs/document';
import type { BookDoc } from '@/libs/document';

// The @pdfjs alias in vitest.config.mts resolves to public/vendor/pdfjs,
// mirroring how foliate-js/pdf.js does `import '@pdfjs/pdf.min.mjs'`.
const vendorDir = join(process.cwd(), 'public/vendor');

/** Strip all XML/SSML tags to get plain text content */
const stripTags = (ssml: string): string => ssml.replace(/<[^>]+\/?>/g, '').trim();

const highlight = vi.fn();

/**
 * Build a document that mimics a rendered PDF page with text layer,
 * matching the structure that pdf.js produces in the iframe.
 */
const createPDFTextLayerDoc = (textSpans: string[], annotationText?: string): Document => {
  const parser = new DOMParser();
  const spans = textSpans.map((t) => `<span>${t}</span>`).join('');
  const annotation = annotationText
    ? `<div class="annotationLayer"><a href="#">${annotationText}</a></div>`
    : '<div class="annotationLayer"></div>';
  const html =
    `<!DOCTYPE html><html lang="en">` +
    `<body>` +
    `<div id="canvas"><canvas></canvas></div>` +
    `<div class="textLayer">${spans}</div>` +
    `${annotation}` +
    `</body></html>`;
  return parser.parseFromString(html, 'text/html');
};

/** Node filter matching what TTSController uses for PDFs */
const pdfNodeFilter = createRejectFilter({
  tags: ['rt', 'canvas'],
  classes: ['annotationLayer'],
  contents: [{ tag: 'a', content: /^[\[\(]?[\*\d]+[\)\]]?$/ }],
});

describe('PDF TTS', () => {
  describe('TTS with PDF text layer document', () => {
    it('should generate SSML from text layer spans', () => {
      const doc = createPDFTextLayerDoc(['Alice was beginning to get very ', 'tired of sitting']);
      const tts = new TTS(doc, textWalker, pdfNodeFilter, highlight, 'word');
      const ssml = tts.start();

      expect(ssml).toBeTruthy();
      const text = stripTags(ssml!);
      expect(text).toContain('Alice');
      expect(text).toContain('tired');
    });

    it('should filter out canvas content', () => {
      const doc = createPDFTextLayerDoc(['Hello world']);
      const tts = new TTS(doc, textWalker, pdfNodeFilter, highlight, 'word');
      const ssml = tts.start();

      expect(ssml).toBeTruthy();
      expect(stripTags(ssml!)).toBe('Hello world');
    });

    it('should filter out annotation layer text', () => {
      const doc = createPDFTextLayerDoc(['Main text content'], 'Link annotation text');
      const tts = new TTS(doc, textWalker, pdfNodeFilter, highlight, 'word');

      const allText: string[] = [];
      let ssml = tts.start();
      while (ssml) {
        allText.push(stripTags(ssml));
        ssml = tts.next();
      }
      const combined = allText.join(' ');

      expect(combined).toContain('Main text content');
      expect(combined).not.toContain('Link annotation text');
    });

    it('should produce valid SSML with speak root element', () => {
      const doc = createPDFTextLayerDoc(['Test content']);
      const tts = new TTS(doc, textWalker, pdfNodeFilter, highlight, 'word');
      const ssml = tts.start();

      expect(ssml).toBeTruthy();
      expect(ssml).toContain('<speak');
      expect(ssml).toContain('</speak>');
    });

    it('should include mark elements in SSML output', () => {
      const doc = createPDFTextLayerDoc(['Some text with multiple words']);
      const tts = new TTS(doc, textWalker, pdfNodeFilter, highlight, 'word');
      const ssml = tts.start();

      expect(ssml).toBeTruthy();
      expect(ssml).toContain('<mark');
    });
  });

  describe('PDF node filter', () => {
    it('should reject canvas elements', () => {
      const canvas = document.createElement('canvas');
      expect(pdfNodeFilter(canvas)).toBe(NodeFilter.FILTER_REJECT);
    });

    it('should reject annotationLayer elements', () => {
      const div = document.createElement('div');
      div.className = 'annotationLayer';
      expect(pdfNodeFilter(div)).toBe(NodeFilter.FILTER_REJECT);
    });

    it('should reject rt elements', () => {
      const rt = document.createElement('rt');
      expect(pdfNodeFilter(rt)).toBe(NodeFilter.FILTER_REJECT);
    });

    it('should skip regular div elements', () => {
      const div = document.createElement('div');
      div.className = 'textLayer';
      expect(pdfNodeFilter(div)).toBe(NodeFilter.FILTER_SKIP);
    });

    it('should accept text nodes', () => {
      const text = document.createTextNode('hello');
      expect(pdfNodeFilter(text)).toBe(NodeFilter.FILTER_ACCEPT);
    });

    it('should reject footnote-like anchor content', () => {
      const a = document.createElement('a');
      a.textContent = '[1]';
      expect(pdfNodeFilter(a)).toBe(NodeFilter.FILTER_REJECT);
    });

    it('should not reject normal anchor content', () => {
      const a = document.createElement('a');
      a.textContent = 'Click here for more';
      expect(pdfNodeFilter(a)).toBe(NodeFilter.FILTER_SKIP);
    });
  });

  describe('DocumentLoader with sample-alice.pdf', () => {
    let book: BookDoc;

    beforeAll(async () => {
      // Override workerSrc to an absolute file path so the pdfjs fake-worker
      // can import it inside jsdom (the module-level code in pdf.js sets it
      // to a URL path that only works in a real browser).
      // Import pdf.js first to trigger the @pdfjs side-effect that sets globalThis.pdfjsLib.
      await import('foliate-js/pdf.js');
      const pdfjsLib = (globalThis as Record<string, unknown>)['pdfjsLib'] as {
        GlobalWorkerOptions: { workerSrc: string };
      };
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        `file://${join(vendorDir, 'pdfjs/pdf.worker.min.mjs')}`,
      ).href;

      const pdfPath = resolve(__dirname, '../fixtures/data/sample-alice.pdf');
      const buffer = readFileSync(pdfPath);
      const file = new File([buffer], 'sample-alice.pdf', { type: 'application/pdf' });
      const loader = new DocumentLoader(file);
      const result = await loader.open();
      book = result.book;
      expect(result.format).toBe('PDF');
    }, 30_000);

    it('should load the sample PDF and return a book object', () => {
      expect(book).toBeTruthy();
      expect(book.rendition.layout).toBe('pre-paginated');
    });

    it('should have sections matching the number of pages', () => {
      expect(book.sections).toBeTruthy();
      expect(book.sections.length).toBeGreaterThan(0);
    });

    it('should extract metadata', () => {
      expect(book.metadata).toBeTruthy();
      // sample-alice.pdf should have a title
      expect(book.metadata.title).toBeTruthy();
    });

    it('should provide createDocument on every section', () => {
      for (const section of book.sections) {
        expect(typeof section.createDocument).toBe('function');
      }
    });

    it('should generate TTS SSML from createDocument output', async () => {
      const doc = await book.sections[0]!.createDocument();
      const tts = new TTS(doc, textWalker, undefined, highlight, 'word');
      const ssml = tts.start();

      expect(ssml).toBeTruthy();
      expect(ssml).toContain('<speak');
      expect(ssml).toContain('<mark');

      const text = stripTags(ssml!);
      expect(text.length).toBeGreaterThan(0);
    });

    it('should navigate through all TTS blocks of a page', async () => {
      const doc = await book.sections[0]!.createDocument();
      const tts = new TTS(doc, textWalker, undefined, highlight, 'word');

      const blocks: string[] = [];
      let ssml = tts.start();
      while (ssml) {
        blocks.push(stripTags(ssml));
        ssml = tts.next();
      }

      expect(blocks.length).toBeGreaterThan(0);
      for (const block of blocks) {
        expect(block.length).toBeGreaterThan(0);
      }
    });

    it('should produce createDocument output for multiple pages', async () => {
      const pagesToTest = Math.min(book.sections.length, 3);

      for (let i = 0; i < pagesToTest; i++) {
        const doc = await book.sections[i]!.createDocument();
        expect(doc).toBeTruthy();

        const tts = new TTS(doc, textWalker, undefined, highlight, 'word');
        const ssml = tts.start();
        expect(ssml).toBeTruthy();
        expect(stripTags(ssml!).length).toBeGreaterThan(0);
      }
    });

    it('should return consistent text across repeated createDocument calls', async () => {
      const doc1 = await book.sections[0]!.createDocument();
      const doc2 = await book.sections[0]!.createDocument();

      const tts1 = new TTS(doc1, textWalker, undefined, highlight, 'word');
      const tts2 = new TTS(doc2, textWalker, undefined, highlight, 'word');

      expect(stripTags(tts1.start()!)).toBe(stripTags(tts2.start()!));
    });

    it('should work with sentence granularity on real PDF content', async () => {
      const doc = await book.sections[0]!.createDocument();
      const tts = new TTS(doc, textWalker, undefined, highlight, 'sentence');
      const ssml = tts.start();

      expect(ssml).toBeTruthy();
      expect(stripTags(ssml!).length).toBeGreaterThan(0);
    });

    it('should call highlight callback when marking words from PDF', async () => {
      highlight.mockClear();
      const doc = await book.sections[0]!.createDocument();
      const tts = new TTS(doc, textWalker, undefined, highlight, 'word');
      tts.start();

      const range = tts.setMark('0');
      expect(range).toBeTruthy();
      expect(highlight).toHaveBeenCalled();
    });
  });
});
