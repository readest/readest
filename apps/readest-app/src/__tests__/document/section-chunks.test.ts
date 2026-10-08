import { describe, it, expect } from 'vitest';
import * as CFI from 'foliate-js/epubcfi.js';
import { CHUNK_ATTRIBUTE, adjacentChunkElement, splitSection } from 'foliate-js/section-chunks.js';

// A section like a single-file book: many top-level blocks, some nested markup,
// and loose text between the blocks.
const section = (blocks: number) => {
  const body = Array.from({ length: blocks }, (_, i) =>
    i % 10 === 0
      ? `<h3 id="h${i}">Entry ${i}</h3>`
      : `<p id="p${i}">Text of <b id="b${i}">block</b> <a name="n${i}" href="#h0">${i}</a></p>`,
  ).join('\n');
  return `<!DOCTYPE html><html lang="en"><head><title>T</title><style>p{color:red}</style></head><body class="b">${body}</body></html>`;
};

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');
const chunksOf = (split: ReturnType<typeof splitSection>) =>
  Array.from({ length: split.count }, (_, k) => parse(split.chunk(k)));

describe('splitSection', () => {
  it('keeps every top-level element, as a placeholder outside the chunk', () => {
    const html = section(200);
    const full = Array.from(parse(html).body.children);
    for (const chunk of chunksOf(splitSection(html, 4))) {
      const kids = Array.from(chunk.body.children);
      expect(kids.map((el) => el.localName)).toEqual(full.map((el) => el.localName));
    }
  });

  it('puts each top-level element in full into exactly one chunk', () => {
    const html = section(200);
    const split = splitSection(html, 4);
    const docs = chunksOf(split);
    Array.from(parse(html).body.children).forEach((el, i) => {
      const owners = docs.filter((d) => !d.body.children[i]!.hasAttribute(CHUNK_ATTRIBUTE));
      expect(owners).toHaveLength(1);
      expect(owners[0]!.body.children[i]!.outerHTML).toBe(el.outerHTML);
      expect(docs.indexOf(owners[0]!)).toBe(split.chunkOf[i]);
    });
  });

  it('cuts into chunks of about equal size, keeping the head and body attributes', () => {
    const split = splitSection(section(400), 4);
    expect(split.count).toBe(4);
    for (const d of chunksOf(split)) {
      expect(d.documentElement.lang).toBe('en');
      expect(d.body.className).toBe('b');
      expect(d.title).toBe('T');
      const own = Array.from(d.body.children).filter((el) => !el.hasAttribute(CHUNK_ATTRIBUTE));
      expect(own.length).toBeGreaterThan(80);
      expect(own.length).toBeLessThan(120);
    }
  });

  it('gives a range in a chunk the same CFI as in the full section', () => {
    const html = section(200);
    const full = parse(html);
    const split = splitSection(html, 4);
    const docs = chunksOf(split);
    for (const id of ['p57', 'h120', 'p199']) {
      const fullEl = full.getElementById(id)!;
      const fullRange = full.createRange();
      fullRange.selectNodeContents(fullEl.querySelector('a') ?? fullEl);
      const top = Array.prototype.indexOf.call(full.body.children, fullEl);
      const chunk = docs[split.chunkOf[top]!]!;
      const chunkEl = chunk.getElementById(id)!;
      const chunkRange = chunk.createRange();
      chunkRange.selectNodeContents(chunkEl.querySelector('a') ?? chunkEl);
      expect(CFI.fromRange(chunkRange)).toBe(CFI.fromRange(fullRange));
      // and the section CFI resolves back to that node in the chunk
      const resolved = CFI.toRange(chunk, CFI.parse(CFI.fromRange(fullRange)));
      expect(resolved.toString()).toBe(fullRange.toString());
    }
  });

  describe('locate', () => {
    const html = section(200);
    const full = parse(html);
    const split = splitSection(html, 4);
    const chunkOfTop = (id: string) => {
      let el = full.getElementById(id) ?? full.querySelector(`[name="${id}"]`)!;
      while (el.parentElement !== full.body) el = el.parentElement!;
      return split.chunkOf[Array.prototype.indexOf.call(full.body.children, el)];
    };

    it('finds the chunk of a top-level or nested id', () => {
      for (const id of ['h0', 'p57', 'b151', 'b199']) {
        expect(split.locate((doc: Document) => doc.getElementById(id))).toEqual({
          chunk: chunkOfTop(id),
        });
      }
    });

    it('finds the chunk of a named anchor', () => {
      expect(split.locate((doc: Document) => doc.querySelector('[name="n123"]'))).toEqual({
        chunk: chunkOfTop('n123'),
      });
    });

    it('finds the chunk of a CFI deep inside another chunk', () => {
      const range = full.createRange();
      range.setStart(full.getElementById('b163')!.firstChild!, 2);
      range.setEnd(full.getElementById('b163')!.firstChild!, 4);
      const parts = CFI.parse(CFI.fromRange(range));
      expect(split.locate((doc: Document) => CFI.toRange(doc, parts))).toEqual({
        chunk: chunkOfTop('b163'),
      });
    });

    it('maps a fraction of the section to a fraction of its chunk', () => {
      expect(split.locate(() => 0)).toEqual({ chunk: 0, anchor: 0 });
      expect(split.locate(() => 0.6)).toEqual({ chunk: 2, anchor: expect.closeTo(0.4) });
    });

    it('falls back to the first chunk when the anchor resolves nowhere', () => {
      expect(split.locate((doc: Document) => doc.getElementById('missing'))).toEqual({
        chunk: 0,
      });
    });
  });
});

describe('adjacentChunkElement', () => {
  const html = section(200);
  const split = splitSection(html, 4);
  const docs = chunksOf(split);
  const firstOf = (k: number) => split.chunkOf.indexOf(k);
  const lastOf = (k: number) => split.chunkOf.lastIndexOf(k);

  it('points at the first element of the next chunk', () => {
    expect(adjacentChunkElement(docs[0]!, 1)).toBe(firstOf(1));
    expect(adjacentChunkElement(docs[2]!, 1)).toBe(firstOf(3));
  });

  it('points at the last element of the previous chunk', () => {
    expect(adjacentChunkElement(docs[1]!, -1)).toBe(lastOf(0));
    expect(adjacentChunkElement(docs[3]!, -1)).toBe(lastOf(2));
  });

  it('is -1 at either end of the section and outside chunks', () => {
    expect(adjacentChunkElement(docs[0]!, -1)).toBe(-1);
    expect(adjacentChunkElement(docs[3]!, 1)).toBe(-1);
    expect(adjacentChunkElement(parse(html), 1)).toBe(-1);
    expect(adjacentChunkElement(parse(html), -1)).toBe(-1);
  });
});
