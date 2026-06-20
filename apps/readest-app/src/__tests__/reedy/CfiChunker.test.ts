/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import * as CFI from 'foliate-js/epubcfi.js';
import { chunkSection } from '@/services/reedy/retrieval/CfiChunker';

function makeDoc(bodyHtml: string): Document {
  return new DOMParser().parseFromString(
    `<!DOCTYPE html><html><body>${bodyHtml}</body></html>`,
    'text/html',
  );
}

/**
 * Strip the wrapping `epubcfi(...)` and the leading `/6/N!` spine step that
 * CfiChunker prepends, so we can hand the inner path to CFI.toRange against
 * the section document.
 */
function innerCfi(stored: string): string {
  const m = stored.match(/^epubcfi\((.+)\)$/);
  if (!m) throw new Error(`malformed CFI: ${stored}`);
  const inner = m[1]!;
  const spineSplit = inner.indexOf('!');
  return spineSplit >= 0 ? `epubcfi(${inner.slice(spineSplit + 1)})` : `epubcfi(${inner})`;
}

function normalizeWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

describe('CfiChunker', () => {
  it('returns no chunks for an image-only document with no extractable text', () => {
    const doc = makeDoc('<img src="cover.png" alt="" />');
    const chunks = chunkSection(doc, 0, 'Front', 'bk1');
    expect(chunks).toEqual([]);
  });

  it('returns no chunks when the body is empty', () => {
    const doc = makeDoc('');
    const chunks = chunkSection(doc, 0, 'Empty', 'bk1');
    expect(chunks).toEqual([]);
  });

  it('produces a single chunk for a short section that fits under the size limit', () => {
    const doc = makeDoc('<p>Hello world.</p>');
    const chunks = chunkSection(doc, 0, 'Greeting', 'bk1');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.text).toContain('Hello world');
    expect(chunks[0]!.bookHash).toBe('bk1');
    expect(chunks[0]!.sectionIndex).toBe(0);
    expect(chunks[0]!.chapterTitle).toBe('Greeting');
    expect(chunks[0]!.positionIndex).toBe(0);
  });

  it('prepends the EPUB spine prefix /6/{(idx+1)*2}! to stored CFIs', () => {
    const doc = makeDoc('<p>Hello world.</p>');
    const chunks = chunkSection(doc, 3, 'Ch4', 'bk1');
    expect(chunks[0]!.startCfi).toMatch(/^epubcfi\(\/6\/8!/);
    expect(chunks[0]!.endCfi).toMatch(/^epubcfi\(\/6\/8!/);
  });

  it('generates CFIs that round-trip via CFI.toRange and resolve to the chunk text', () => {
    const doc = makeDoc(
      '<p id="p1">First paragraph here.</p><p id="p2">Second has <em>emphasis</em> and more text.</p>',
    );
    const chunks = chunkSection(doc, 0, 'Roundtrip', 'bk1');
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) {
      const parts = CFI.parse(innerCfi(c.startCfi));
      const range = CFI.toRange(doc, parts);
      expect(range, `toRange returned null for ${c.startCfi}`).not.toBeNull();
      // The resolved range's start position should fall inside the chunk text.
      const resolvedText = range!.toString();
      // We don't require an exact equality here because toRange returns a
      // collapsed start range; instead verify the first 8 chars of the chunk
      // align with the text starting at the resolved start position.
      const chunkHead = normalizeWs(c.text).slice(0, 8);
      if (chunkHead.length > 0) {
        // Build a fresh range from the start CFI through end CFI and compare.
        const endParts = CFI.parse(innerCfi(c.endCfi));
        const endRange = CFI.toRange(doc, endParts);
        expect(endRange).not.toBeNull();
        const fullRange = doc.createRange();
        fullRange.setStart(range!.startContainer, range!.startOffset);
        fullRange.setEnd(endRange!.startContainer, endRange!.startOffset);
        expect(normalizeWs(fullRange.toString())).toBe(normalizeWs(c.text));
      } else {
        expect(resolvedText).toBeDefined();
      }
    }
  });

  it('skips text inside <script>, <style>, and <noscript>', () => {
    const doc = makeDoc(
      '<p>Visible text here.</p>' +
        '<script>alert("hidden");</script>' +
        '<style>.x{color:red}</style>' +
        '<noscript>no js</noscript>' +
        '<p>Another visible paragraph.</p>',
    );
    const chunks = chunkSection(doc, 0, 'Filtering', 'bk1');
    const allText = chunks.map((c) => c.text).join(' ');
    expect(allText).not.toContain('alert(');
    expect(allText).not.toContain('color:red');
    expect(allText).not.toContain('no js');
    expect(allText).toContain('Visible text here');
    expect(allText).toContain('Another visible paragraph');
  });

  it('splits long content into multiple chunks with monotonically increasing position_index', () => {
    const paragraph = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(40);
    const doc = makeDoc(`<p>${paragraph}</p><p>${paragraph}</p>`);
    const chunks = chunkSection(doc, 0, 'Long', 'bk1', {
      maxChunkSize: 300,
      minChunkSize: 50,
      overlapSize: 30,
    });
    expect(chunks.length).toBeGreaterThan(1);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!.positionIndex).toBe(chunks[i - 1]!.positionIndex + 1);
    }
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(400); // maxChunkSize + breakSlack
    }
  });

  it('produces token_count approximating whitespace-separated word count', () => {
    const doc = makeDoc('<p>one two three four five</p>');
    const chunks = chunkSection(doc, 0, 'Tokens', 'bk1');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.tokenCount).toBe(5);
  });

  it('assigns deterministic ids that include book hash, section, and position', () => {
    const doc = makeDoc('<p>A</p><p>B</p>');
    const chunks = chunkSection(doc, 2, 'Det', 'hashXYZ', {
      maxChunkSize: 1,
      minChunkSize: 1,
      overlapSize: 0,
    });
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i]!.id).toContain('hashXYZ');
      expect(chunks[i]!.id).toContain('2');
      expect(chunks[i]!.id).toContain(`${i}`);
    }
  });
});
