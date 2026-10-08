import { describe, it, expect } from 'vitest';
import * as CFI from 'foliate-js/epubcfi.js';
import { CHUNK_ATTRIBUTE, chunkOfNode, splitSection } from 'foliate-js/section-chunks.js';

// A section like a single-file book: many top-level blocks, some nested markup,
// and loose text between the blocks.
const section = (blocks: number) => {
  const body = Array.from({ length: blocks }, (_, i) =>
    i % 10 === 0
      ? `<h3 id="h${i}">Entry ${i}</h3>`
      : `<p id="p${i}">Text of <b>block</b> <a href="#h0">${i}</a></p>`,
  ).join('\n');
  return `<!DOCTYPE html><html lang="en"><head><title>T</title><style>p{color:red}</style></head><body class="b">${body}</body></html>`;
};

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');

describe('splitSection', () => {
  it('keeps every top-level element, as a placeholder outside the chunk', () => {
    const { doc, chunks } = splitSection(section(200), 4);
    const full = Array.from(doc.body.children);
    for (const html of chunks) {
      const kids = Array.from(parse(html).body.children);
      expect(kids.map((el) => el.localName)).toEqual(full.map((el) => el.localName));
    }
  });

  it('puts each top-level element in full into exactly one chunk', () => {
    const { doc, chunks, chunkOf } = splitSection(section(200), 4);
    const docs = chunks.map(parse);
    Array.from(doc.body.children).forEach((el, i) => {
      const owners = docs.filter((d) => !d.body.children[i]!.hasAttribute(CHUNK_ATTRIBUTE));
      expect(owners).toHaveLength(1);
      expect(owners[0]!.body.children[i]!.outerHTML).toBe(el.outerHTML);
      expect(docs.indexOf(owners[0]!)).toBe(chunkOf[i]);
    });
  });

  it('cuts into chunks of about equal size, keeping the head and body attributes', () => {
    const { chunks } = splitSection(section(400), 4);
    expect(chunks).toHaveLength(4);
    for (const html of chunks) {
      const d = parse(html);
      expect(d.documentElement.lang).toBe('en');
      expect(d.body.className).toBe('b');
      expect(d.title).toBe('T');
      const own = Array.from(d.body.children).filter((el) => !el.hasAttribute(CHUNK_ATTRIBUTE));
      expect(own.length).toBeGreaterThan(80);
      expect(own.length).toBeLessThan(120);
    }
  });

  it('gives a range in a chunk the same CFI as in the full section', () => {
    const { doc, chunks, chunkOf } = splitSection(section(200), 4);
    for (const id of ['p57', 'h120', 'p199']) {
      const fullRange = doc.createRange();
      fullRange.selectNodeContents(
        doc.getElementById(id)!.querySelector('a') ?? doc.getElementById(id)!,
      );
      const chunk = parse(
        chunks[chunkOf[Array.prototype.indexOf.call(doc.body.children, doc.getElementById(id))]!]!,
      );
      const chunkRange = chunk.createRange();
      chunkRange.selectNodeContents(
        chunk.getElementById(id)!.querySelector('a') ?? chunk.getElementById(id)!,
      );
      expect(CFI.fromRange(chunkRange)).toBe(CFI.fromRange(fullRange));
      // and the section CFI resolves back to that node in the chunk
      const resolved = CFI.toRange(chunk, CFI.parse(CFI.fromRange(fullRange)));
      expect(resolved.toString()).toBe(fullRange.toString());
    }
  });

  it('finds the chunk of a nested node', () => {
    const { doc, chunkOf } = splitSection(section(200), 4);
    const nested = doc.getElementById('p151')!.querySelector('b')!.firstChild!;
    expect(chunkOfNode(doc, chunkOf, nested)).toBe(chunkOf[151]);
    expect(chunkOfNode(doc, chunkOf, null)).toBe(0);
  });
});
