import { describe, it, expect, vi } from 'vitest';
import { makeMarkdownBook } from '@/utils/md';
import type { BookDoc } from '@/libs/document';
import { CFI } from '@/libs/document';
import { getIndexFromCfi } from '@/utils/cfi';

// makeMarkdownBook returns a foliate book with a few methods (resolveHref,
// isExternal, destroy) and a per-section load() that the BookDoc type does not
// declare. Cast to this richer shape in tests to exercise them.
type MdBook = BookDoc & {
  toc: NonNullable<BookDoc['toc']>;
  sections: Array<BookDoc['sections'][number] & { load: () => string }>;
  resolveHref: (
    href: string,
  ) => { index: number; anchor: (doc: Document) => Element | null } | null;
  isExternal: (uri: string) => boolean;
  destroy: () => void;
};

const mdFile = (content: string, name = 'note.md', type = 'text/markdown') =>
  new File([content], name, { type });

const make = async (content: string, name?: string, type?: string) =>
  (await makeMarkdownBook(mdFile(content, name, type))) as unknown as MdBook;

const flattenToc = (items: BookDoc['toc'] = []): NonNullable<BookDoc['toc']> =>
  items.flatMap((i) => [i, ...(i.subitems ? flattenToc(i.subitems) : [])]);

describe('makeMarkdownBook', () => {
  it('renders headings, inline marks, lists, code and tables', async () => {
    const book = await make(
      '# Title\n\nHello **world**.\n\n- a\n- b\n\n```js\nconst x = 1;\n```\n\n| h |\n| - |\n| v |\n',
    );
    const doc = await book.sections[0]!.createDocument();
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.querySelector('h1')?.textContent).toBe('Title');
    expect(doc.querySelector('strong')?.textContent).toBe('world');
    expect(doc.querySelectorAll('li').length).toBe(2);
    expect(doc.querySelector('table')).toBeTruthy();
    expect(doc.querySelector('code')?.getAttribute('class')).toContain('language-js');
  });

  it('splits at H1 into one section per chapter, nests deeper headings in the TOC', async () => {
    const book = await make('# One\n\na\n\n## Sub\n\nb\n\n# Two\n\nc\n');
    expect(book.sections.map((s) => s.id)).toEqual(['0', '1']);
    expect(book.toc.length).toBe(2);
    expect(book.toc[0]!.label).toBe('One');
    expect(book.toc[0]!.href).toBe('0#one');
    expect(book.toc[0]!.subitems![0]!.label).toBe('Sub');
    expect(book.toc[0]!.subitems![0]!.href).toBe('0#sub');
    expect(book.toc[1]!.href).toBe('1#two');
  });

  it('treats content before the first H1 as a leading preamble section', async () => {
    const book = await make('Intro text.\n\n# Only\n\nbody\n');
    expect(book.sections.length).toBe(2);
    expect(book.toc.length).toBe(1);
    expect(book.toc[0]!.href).toBe('1#only');
  });

  it('yields a single section with a usable TOC when there is no H1', async () => {
    const book = await make('## Sub only\n\ntext\n');
    expect(book.sections.length).toBe(1);
    expect(book.toc.length).toBe(1);
    expect(book.toc[0]!.href).toBe('0#sub-only');
  });

  it('de-duplicates heading ids deterministically', async () => {
    const book = await make('# Dup\n\n## Dup\n\n### Dup\n');
    const ids = flattenToc(book.toc).map((i) => i.href.split('#')[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(['dup', 'dup-1', 'dup-2']);
  });

  it('keeps section ids as strings that resolve in a string-keyed section map (nav contract)', async () => {
    const book = await make('# A\n\n## A1\n\n# B\n');
    const sectionMap = new Map(book.sections.map((s) => [s.id, s]));
    for (const item of flattenToc(book.toc)) {
      const [sid] = book.splitTOCHref(item.href);
      expect(typeof sid).toBe('string');
      expect(sectionMap.get(sid as string)).toBeDefined();
    }
  });

  it('gives each section a CFI base that round-trips to its index (resume position)', async () => {
    // foliate-js view.getCFI does `section.cfi ?? CFI.fake.fromIndex(index)`,
    // so an empty-string cfi defeats the fallback and the generated location
    // CFI loses its spine step. Reopening then resolves to no section and the
    // reader falls back to the start. Verify each section carries a base CFI
    // that survives the getCFI -> resolveCFI round-trip.
    const book = await make('# One\n\na\n\n# Two\n\nb\n\n# Three\n\nc\n');
    book.sections.forEach((section, index) => {
      const baseCFI = section.cfi ?? CFI.fake.fromIndex(index);
      const locationCFI = CFI.joinIndir(baseCFI, '/4/2:3');
      expect(getIndexFromCfi(locationCFI)).toBe(index);
    });
  });

  it('produces XHTML that parses without errors despite void tags', async () => {
    const book = await make('# H\n\nline one  \nline two\n\n---\n\n![alt](https://e.com/i.png)\n');
    const doc = await book.sections[0]!.createDocument();
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.querySelector('br')).toBeTruthy();
    expect(doc.querySelector('img')?.getAttribute('src')).toBe('https://e.com/i.png');
  });

  it('resolves TOC links, internal anchors, and rejects unknown/external', async () => {
    const book = await make('# A\n\njump [x](#b-sec)\n\n# B Sec\n');
    expect(book.resolveHref('1#b-sec')).toMatchObject({ index: 1 });
    expect(book.resolveHref('#b-sec')).toMatchObject({ index: 1 });
    expect(book.resolveHref('#missing')).toBeNull();
    expect(book.resolveHref('9#x')).toBeNull();
    expect(book.isExternal('https://example.com')).toBe(true);
    expect(book.isExternal('mailto:a@b.com')).toBe(true);
    expect(book.isExternal('#b-sec')).toBe(false);
  });

  it('strips scripts and event handlers but keeps code class and heading ids', async () => {
    const book = await make(
      '# H\n\n<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">\n\n```ts\nok\n```\n',
    );
    const doc = await book.sections[0]!.createDocument();
    expect(doc.querySelector('script')).toBeNull();
    expect(doc.querySelector('img')?.getAttribute('onerror')).toBeNull();
    expect(doc.querySelector('code')?.getAttribute('class')).toContain('language-ts');
    expect(doc.querySelector('h1')?.getAttribute('id')).toBeTruthy();
  });

  it('resolves the title from frontmatter, then first H1, then filename', async () => {
    const fm = await make('---\ntitle: From Front\nauthor: Jane Doe\n---\n\n# Ignored\n');
    expect(fm.metadata.title).toBe('From Front');
    expect(fm.metadata.author).toBe('Jane Doe');
    const h1 = await make('# The Heading\n\nbody\n');
    expect(h1.metadata.title).toBe('The Heading');
    const fn = await make('just text\n', 'My Notes.md');
    expect(fn.metadata.title).toBe('My Notes');
  });

  it('creates object URLs lazily and revokes every one on destroy', async () => {
    const url = URL as unknown as {
      createObjectURL: (b: Blob) => string;
      revokeObjectURL: (u: string) => void;
    };
    const origCreate = url.createObjectURL;
    const origRevoke = url.revokeObjectURL;
    const revoked: string[] = [];
    let n = 0;
    url.createObjectURL = vi.fn(() => `blob:md-${n++}`);
    url.revokeObjectURL = vi.fn((u: string) => void revoked.push(u));
    try {
      const book = await make('# A\n\n# B\n');
      expect(url.createObjectURL).toHaveBeenCalledTimes(0); // lazy
      const u0 = book.sections[0]!.load();
      expect(book.sections[0]!.load()).toBe(u0); // cached per section
      expect(url.createObjectURL).toHaveBeenCalledTimes(1);
      book.destroy();
      expect(revoked).toContain(u0);
    } finally {
      url.createObjectURL = origCreate;
      url.revokeObjectURL = origRevoke;
    }
  });
});

describe('DocumentLoader markdown routing', () => {
  it('routes .md, .markdown and a markdown blob typed text/plain to MD format', async () => {
    const { DocumentLoader } = await import('@/libs/document');
    const cases = [
      mdFile('# X\n', 'a.md', 'text/markdown'),
      mdFile('# X\n', 'a.markdown', ''),
      mdFile('# X\n', 'a.md', 'text/plain'),
    ];
    for (const file of cases) {
      const { format } = await new DocumentLoader(file).open();
      expect(format).toBe('MD');
    }
  });
});
