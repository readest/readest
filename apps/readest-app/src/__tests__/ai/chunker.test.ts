import { describe, test, expect, vi } from 'vitest';

// mock the types module to avoid import issues
vi.mock('../types', () => ({
  TextChunk: {},
}));

import { extractTextFromDocument, chunkSection } from '@/services/ai/utils/chunker';

describe('AI Chunker', () => {
  const createDocument = (html: string): Document => {
    const parser = new DOMParser();
    return parser.parseFromString(`<!DOCTYPE html><html><body>${html}</body></html>`, 'text/html');
  };

  describe('extractTextFromDocument', () => {
    test('should extract text from simple HTML', () => {
      const doc = createDocument('<p>Hello world</p>');
      const text = extractTextFromDocument(doc);
      expect(text).toBe('Hello world');
    });

    test('should remove script and style tags', () => {
      const doc = createDocument(`
        <p>Visible text</p>
        <script>console.log('ignored')</script>
        <style>.hidden { display: none; }</style>
        <p>More text</p>
      `);
      const text = extractTextFromDocument(doc);
      expect(text).toContain('Visible text');
      expect(text).toContain('More text');
      expect(text).not.toContain('console.log');
      expect(text).not.toContain('.hidden');
    });

    test('should handle empty document', () => {
      const doc = createDocument('');
      const text = extractTextFromDocument(doc);
      expect(text).toBe('');
    });

    test('should trim whitespace', () => {
      const doc = createDocument('   <p>  Text with spaces  </p>   ');
      const text = extractTextFromDocument(doc);
      expect(text).toBe('Text with spaces');
    });
  });

  describe('chunkSection', () => {
    const bookHash = 'test-hash';
    const sectionIndex = 0;
    const chapterTitle = 'Chapter 1';

    test('should create single chunk for short text', () => {
      const doc = createDocument('<p>Short text that is less than max chunk size.</p>');
      const chunks = chunkSection(doc, sectionIndex, chapterTitle, bookHash, 0);

      expect(chunks.length).toBe(1);
      expect(chunks[0]!.id).toBe(`${bookHash}-${sectionIndex}-0`);
      expect(chunks[0]!.bookHash).toBe(bookHash);
      expect(chunks[0]!.sectionIndex).toBe(sectionIndex);
      expect(chunks[0]!.chapterTitle).toBe(chapterTitle);
    });

    test('should split long text into multiple chunks', () => {
      const longText = 'Lorem ipsum dolor sit amet. '.repeat(50);
      const doc = createDocument(`<p>${longText}</p>`);
      const chunks = chunkSection(doc, sectionIndex, chapterTitle, bookHash, 0);

      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach((chunk, i) => {
        expect(chunk.id).toBe(`${bookHash}-${sectionIndex}-${i}`);
      });
    });

    test('should return empty array for empty document', () => {
      const doc = createDocument('');
      const chunks = chunkSection(doc, sectionIndex, chapterTitle, bookHash, 0);
      expect(chunks).toEqual([]);
    });

    test('should respect custom chunk options', () => {
      const longText = 'Word '.repeat(100);
      const doc = createDocument(`<p>${longText}</p>`);
      const chunks = chunkSection(doc, sectionIndex, chapterTitle, bookHash, 0, {
        maxChunkSize: 100,
        minChunkSize: 20,
      });

      expect(chunks.length).toBeGreaterThan(1);
      // all chunks except last should be close to maxChunkSize
      chunks.slice(0, -1).forEach((chunk) => {
        expect(chunk.text.length).toBeLessThanOrEqual(150); // allow some flexibility for break points
      });
    });
  });
});
