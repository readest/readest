import { describe, it, expect } from 'vitest';
import * as CFI from 'foliate-js/epubcfi.js';
import { CHUNK_ATTRIBUTE, adjacentChunkAnchor, splitSection } from 'foliate-js/section-chunks.js';

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

  it('keeps CFIs of elements and loose text with text outside the chunk dropped', () => {
    // Loose text between top-level elements, and between a wrapper's children
    const loose = Array.from({ length: 60 }, (_, i) => `loose ${i} <p id="q${i}">para ${i}</p>`);
    const inner = Array.from({ length: 60 }, (_, i) => `text ${i} <p id="r${i}">row ${i}</p>`);
    const html = `<!DOCTYPE html><html><head></head><body>${loose.join('')}<div>${inner.join('')}</div> tail</body></html>`;
    const full = parse(html);
    const split = splitSection(html, 6);
    const docs = chunksOf(split);
    const owner = (id: string) =>
      docs.find((d) => {
        const el = d.getElementById(id);
        return el && !el.hasAttribute(CHUNK_ATTRIBUTE);
      })!;
    const ids = [
      ...Array.from({ length: 60 }, (_, i) => `q${i}`),
      ...Array.from({ length: 60 }, (_, i) => `r${i}`),
    ];
    let textDroppedBefore = 0;
    for (const id of ids) {
      const doc = owner(id);
      // the loose text before this element went to the previous chunk
      if (doc.getElementById(id)!.previousSibling?.nodeType !== Node.TEXT_NODE) textDroppedBefore++;
      for (const pick of [
        (d: Document) => d.getElementById(id)!.firstChild!, // text inside the element
        (d: Document) => d.getElementById(id)!.previousSibling!, // loose text before it
      ]) {
        const fullNode = pick(full);
        const chunkNode = pick(doc);
        if (chunkNode?.nodeType !== Node.TEXT_NODE) continue; // that text lives in another chunk
        const range = (d: Document, node: Node) => {
          const r = d.createRange();
          r.setStart(node, 1);
          r.setEnd(node, 3);
          return r;
        };
        const cfi = CFI.fromRange(range(full, fullNode));
        expect(CFI.fromRange(range(doc, chunkNode)), id).toBe(cfi);
        expect(CFI.toRange(doc, CFI.parse(cfi)).toString(), id).toBe(
          range(full, fullNode).toString(),
        );
      }
    }
    // chunk boundaries fell right after loose text, at both levels
    expect(textDroppedBefore).toBeGreaterThanOrEqual(4);
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
      expect(split.locate(() => 0.6)).toEqual({ chunk: 2, anchor: expect.closeTo(0.4, 1) });
    });

    it('falls back to the first chunk when the anchor resolves nowhere', () => {
      expect(split.locate((doc: Document) => doc.getElementById('missing'))).toEqual({
        chunk: 0,
      });
    });
  });
});

describe('adjacentChunkAnchor', () => {
  const html = section(200);
  const split = splitSection(html, 4);
  const docs = chunksOf(split);
  const firstOf = (k: number) => split.chunkOf.indexOf(k);
  const lastOf = (k: number) => split.chunkOf.lastIndexOf(k);
  const at = (anchor: ((doc: Document) => Range) | null, doc: Document) => {
    const range = anchor!(doc);
    expect(range.collapsed).toBe(true);
    return range.startContainer;
  };

  it('points at the first element of the next chunk', () => {
    expect(at(adjacentChunkAnchor(docs[0]!, 1), docs[1]!)).toBe(docs[1]!.body.children[firstOf(1)]);
    expect(at(adjacentChunkAnchor(docs[2]!, 1), docs[3]!)).toBe(docs[3]!.body.children[firstOf(3)]);
  });

  it('points at the last element of the previous chunk', () => {
    expect(at(adjacentChunkAnchor(docs[1]!, -1), docs[0]!)).toBe(docs[0]!.body.children[lastOf(0)]);
    expect(at(adjacentChunkAnchor(docs[3]!, -1), docs[2]!)).toBe(docs[2]!.body.children[lastOf(2)]);
  });

  it('is null at either end of the section and outside chunks', () => {
    expect(adjacentChunkAnchor(docs[0]!, -1)).toBeNull();
    expect(adjacentChunkAnchor(docs[3]!, 1)).toBeNull();
    expect(adjacentChunkAnchor(parse(html), 1)).toBeNull();
    expect(adjacentChunkAnchor(parse(html), -1)).toBeNull();
  });
});

// Converters often wrap the whole body in one element, or in a few: the
// chunks are cut between the children of a wrapper bigger than a chunk.
const wrapped = (wrappers: number, blocks: number) => {
  const divs = Array.from({ length: wrappers }, (_, w) => {
    const ps = Array.from(
      { length: blocks },
      (_, i) => `<p id="w${w}p${i}">Text ${w}.${i} of <b id="w${w}b${i}">block</b></p>\n`,
    ).join('');
    return `<div id="w${w}" class="part">${ps}</div>`;
  }).join('\n');
  return `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body>${divs}</body></html>`;
};
const own = (el: Element) =>
  Array.from(el.children).filter((c) => !c.hasAttribute(CHUNK_ATTRIBUTE));

describe('splitSection with wrappers', () => {
  it('cuts wrappers bigger than a chunk between their children, leaving no chunk empty', () => {
    const html = wrapped(5, 300);
    const split = splitSection(html, 20);
    const docs = chunksOf(split);
    for (const [k, d] of docs.entries()) {
      expect(split.isEmpty(k)).toBe(false);
      // every wrapper keeps its index; one holding this chunk's children is a
      // copy with the same attributes and every child in place
      expect(d.body.children).toHaveLength(5);
      const copies = own(d.body);
      expect(copies.length).toBeGreaterThan(0);
      for (const copy of copies) {
        expect(copy.className).toBe('part');
        expect(copy.children).toHaveLength(300);
      }
      const ps = copies.flatMap(own);
      expect(ps.length).toBeGreaterThan(40);
      expect(ps.length).toBeLessThan(110);
    }
    // each paragraph is in full in exactly one chunk
    const full = parse(html);
    for (const id of ['w0p0', 'w2p150', 'w4p299']) {
      const owners = docs.filter((d) => {
        const el = d.getElementById(id);
        return el && !el.hasAttribute(CHUNK_ATTRIBUTE);
      });
      expect(owners).toHaveLength(1);
      expect(owners[0]!.getElementById(id)!.outerHTML).toBe(full.getElementById(id)!.outerHTML);
    }
  });

  it('gives a range inside a wrapper the same CFI as in the full section', () => {
    const html = wrapped(2, 600);
    const full = parse(html);
    const split = splitSection(html, 8);
    const docs = chunksOf(split);
    for (const id of ['w0b17', 'w1b301', 'w1b599']) {
      const fullRange = full.createRange();
      fullRange.selectNodeContents(full.getElementById(id)!);
      const cfi = CFI.fromRange(fullRange);
      const { chunk } = split.locate((doc: Document) => doc.getElementById(id));
      const chunkDoc = docs[chunk]!;
      expect(chunkDoc.getElementById(id)!.hasAttribute(CHUNK_ATTRIBUTE)).toBe(false);
      const chunkRange = chunkDoc.createRange();
      chunkRange.selectNodeContents(chunkDoc.getElementById(id)!);
      expect(CFI.fromRange(chunkRange)).toBe(cfi);
      expect(split.locate((doc: Document) => CFI.toRange(doc, CFI.parse(cfi)))).toEqual({ chunk });
    }
    // a wrapper's own id goes to its first chunk
    expect(split.locate((doc: Document) => doc.getElementById('w1'))).toEqual({
      chunk: split.locate((doc: Document) => doc.getElementById('w1p0')).chunk,
    });
  });

  it('reads on from a chunk into the next one inside the same wrapper', () => {
    const split = splitSection(wrapped(1, 600), 4);
    const docs = chunksOf(split);
    const [first] = own(own(docs[1]!.body)[0]!);
    expect(adjacentChunkAnchor(docs[0]!, 1)!(docs[1]!).startContainer).toBe(first);
    expect(adjacentChunkAnchor(docs[1]!, -1)!(docs[0]!).startContainer).toBe(
      own(own(docs[0]!.body)[0]!).at(-1),
    );
  });

  it('reads on past nodes the reader injects into a rendered chunk', () => {
    // Readers add their own nodes to a rendered document (a skip link at the
    // top of the body), marked cfi-inert since they are not the book's.
    for (const html of [section(200), wrapped(1, 600)]) {
      const split = splitSection(html, 4);
      const docs = chunksOf(split);
      for (const d of docs) {
        const skip = d.createElement('div');
        skip.setAttribute('cfi-inert', '');
        d.body.prepend(skip);
      }
      const anchor = adjacentChunkAnchor(docs[0]!, 1)!;
      expect(split.locate(anchor)).toEqual({ chunk: 1 });
      const first = (el: Element) =>
        Array.from(el.children).find((c) => !c.matches(`[${CHUNK_ATTRIBUTE}], [cfi-inert]`))!;
      const top = first(docs[1]!.body);
      expect(anchor(docs[1]!).startContainer).toBe(top.localName === 'div' ? first(top) : top);
    }
  });

  it('leaves a wrapper inside a wrapper whole, and the chunks it covers empty', () => {
    const inner = wrapped(1, 600).match(/<body>(.*)<\/body>/s)![1];
    const html = `<!DOCTYPE html><html><head></head><body><div id="outer">${inner}</div><p id="end">End</p></body></html>`;
    const split = splitSection(html, 4);
    expect([0, 1, 2, 3].map((k) => split.isEmpty(k))).toEqual([false, true, true, false]);
    // a position in an empty chunk lies in the wrapper of the chunk before it
    const { chunk, anchor } = split.locate(0.5);
    expect(chunk).toBe(0);
    expect(split.fraction(chunk, anchor!)).toBeCloseTo(0.5);
    expect(split.locate((doc: Document) => doc.getElementById('end'))).toEqual({ chunk: 3 });
  });

  it('maps fractions of the section to chunks and back', () => {
    const split = splitSection(wrapped(3, 200), 6);
    for (const f of [0, 0.1, 0.33, 0.5, 0.9, 0.999]) {
      const { chunk, anchor } = split.locate(f);
      expect(split.isEmpty(chunk)).toBe(false);
      expect(anchor).toBeGreaterThanOrEqual(0);
      expect(anchor).toBeLessThan(1);
      expect(split.fraction(chunk, anchor!)).toBeCloseTo(f);
    }
  });
});
