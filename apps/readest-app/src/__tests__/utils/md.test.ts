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
  sections: Array<
    BookDoc['sections'][number] & {
      load: () => string;
      loadContent?: () => Promise<string>;
      unload?: () => void;
    }
  >;
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

  it('nests every heading level down to H6 in the TOC (issue #5357)', async () => {
    const book = await make(
      '# L1\n\na\n\n## L2\n\nb\n\n### L3\n\nc\n\n#### L4\n\nd\n\n##### L5\n\ne\n\n###### L6\n\nf\n',
    );
    const chain: string[] = [];
    let level: BookDoc['toc'] = book.toc;
    while (level?.length) {
      chain.push(level[0]!.label!);
      level = level[0]!.subitems;
    }
    expect(chain).toEqual(['L1', 'L2', 'L3', 'L4', 'L5', 'L6']);
    // Deep headings must also carry the anchor id their TOC href points at.
    const doc = await book.sections[0]!.createDocument();
    for (const item of flattenToc(book.toc)) {
      expect(doc.getElementById(item.href.split('#')[1]!)).not.toBeNull();
    }
  });

  it('deepens the TOC without changing the rendered markup', async () => {
    // Deeper TOC nesting must stay a TOC-only change: the chapter split still
    // happens at H1 only, and every heading keeps the tag, order and text
    // `marked` produced. The lone addition is the anchor id the TOC href needs.
    const book = await make('# L1\n\na\n\n## L2\n\nb\n\n#### L4\n\nc\n');
    expect(book.sections.length).toBe(1);
    const html = (await book.sections[0]!.loadText!())!;
    const body = html.slice(html.indexOf('<body>') + '<body>'.length, html.lastIndexOf('</body>'));
    const markup = body.replace(/ xmlns="[^"]*"/g, '').replace(/ id="[^"]*"/g, '');
    expect(markup).toBe('<h1>L1</h1>\n<p>a</p>\n<h2>L2</h2>\n<p>b</p>\n<h4>L4</h4>\n<p>c</p>\n');
  });

  it('nests a skipped heading level under its nearest ancestor', async () => {
    const book = await make('# L1\n\na\n\n#### L4\n\nb\n\n## L2\n\nc\n');
    expect(book.toc.length).toBe(1);
    expect(book.toc[0]!.subitems!.map((i) => i.label)).toEqual(['L4', 'L2']);
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

  it('resolves the title from frontmatter, then the filename', async () => {
    const fm = await make('---\ntitle: From Front\nauthor: Jane Doe\n---\n\n# Ignored\n');
    expect(fm.metadata.title).toBe('From Front');
    expect(fm.metadata.author).toBe('Jane Doe');
    const fn = await make('just text\n', 'My Notes.md');
    expect(fn.metadata.title).toBe('My Notes');
  });

  // A heading is body content, not metadata: only frontmatter — an explicit
  // metadata block — may override the name the user gave the file. Taking the
  // first H1 instead made `demo.md` import as "按顺序总结", and every note whose
  // first line is a heading landed in the library under that heading.
  it('titles the book after the file, not the first heading', async () => {
    const h1 = await make('# The Heading\n\nbody\n', 'demo.md');
    expect(h1.metadata.title).toBe('demo');
    // The H1 is picked by tag name, not position, so a later one hijacked the
    // title even when the document opened with an H2.
    const laterH1 = await make('## Intro\n\n# Buried Heading\n\nbody\n', 'Reading Notes.markdown');
    expect(laterH1.metadata.title).toBe('Reading Notes');
  });

  // Issue #5279: the two frontmatter shapes the reporter attached, each pairing
  // a cover with an ISBN. The library reads both off BookDoc.metadata, and the
  // importer writes whatever getCover() returns as the book's cover file.
  it('carries a base64 cover and an ISBN from frontmatter into the book', async () => {
    const gif = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    const book = await make(`---\ncover: ${gif}\nISBN: 979-8985322538\n---\n\n# YAML MD Test\n`);
    expect(book.metadata.isbn).toBe('979-8985322538');
    // With no explicit identifier, the ISBN becomes one, so the same book
    // imported from another copy of the file lands on the same metaHash.
    expect(book.metadata.identifier).toBe('979-8985322538');
    expect(book.metadata.coverImageUrl).toBeUndefined();
    const cover = await book.getCover();
    expect(cover).toBeInstanceOf(Blob);
    expect(cover!.type).toBe('image/gif');
    expect(cover!.size).toBe(42);
  });

  it('carries an http cover URL from frontmatter without fetching it', async () => {
    const url = 'https://m.media-amazon.com/images/I/71JB5kFNJ5L._SL1500_.jpg';
    const book = await make(`---\ncover: ${url}\nISBN: 979-8985322538\n---\n\n# YAML MD Test\n`);
    expect(book.metadata.coverImageUrl).toBe(url);
    expect(await book.getCover()).toBeNull();
  });

  it('lifts the remaining book details out of frontmatter', async () => {
    const book = await make(
      [
        '---',
        'title: Moby Dick',
        'subtitle: The Whale',
        'author:',
        '  - Herman Melville',
        '  - Someone Else',
        'language: fr',
        'publisher: Harper',
        'published: 1851-10-18',
        'description: A whale of a book',
        'tags: [fiction, classics]',
        'series: Sea Tales',
        'series_index: 2',
        'identifier: urn:uuid:abcd',
        '---',
        '',
        '# Chapter One',
      ].join('\n'),
    );
    expect(book.metadata).toMatchObject({
      title: 'Moby Dick',
      subtitle: 'The Whale',
      author: ['Herman Melville', 'Someone Else'],
      language: 'fr',
      publisher: 'Harper',
      published: '1851-10-18',
      description: 'A whale of a book',
      subject: ['fiction', 'classics'],
      series: 'Sea Tales',
      seriesIndex: 2,
      identifier: 'urn:uuid:abcd',
    });
  });

  it('keeps the pre-frontmatter defaults when there is none, so hashes are stable', async () => {
    const book = await make('# The Heading\n\nbody\n', 'My Notes.md');
    expect(book.metadata.identifier).toBe('My Notes.md');
    expect(book.metadata.language).toBe('en');
    expect(book.metadata.author).toBe('');
    expect(await book.getCover()).toBeNull();
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

// #5406 follow-up: MD books get the same transformTarget 'data' pipeline as
// EPUB/MOBI, so display transformers (proofread, simplecc, punctuation, ...)
// apply to Markdown books too. The paginator renders `loadContent()` via
// srcdoc when it is defined, so the transformed content is what gets shown.
describe('makeMarkdownBook display transforms', () => {
  // Mirrors FoliateViewer's getDocTransformHandler contract: replace
  // detail.data with a promise of the transformed markup, or '' on error.
  const attachDisplayTransform = (target: EventTarget, replace: (content: string) => string) => {
    const seen: { name?: string; type?: string }[] = [];
    const listener = vi.fn((event: Event) => {
      const detail = (event as CustomEvent).detail;
      seen.push({ name: detail.name, type: detail.type });
      detail.data = Promise.resolve(detail.data).then((data: string) => replace(data));
    });
    target.addEventListener('data', listener);
    return { seen, listener };
  };

  it('exposes a transformTarget on the book', async () => {
    const book = await make('# A\n\nteh text\n');
    expect(book.transformTarget).toBeInstanceOf(EventTarget);
  });

  it('routes section loadContent through data listeners with the section index as name', async () => {
    const book = await make('# A\n\nteh text\n\n# B\n\nteh other\n');
    const { seen } = attachDisplayTransform(book.transformTarget!, (content) =>
      content.replace(/teh/g, 'the'),
    );
    const content = await book.sections[1]!.loadContent!();
    expect(content).toContain('the other');
    expect(content).not.toContain('teh');
    // Selection-scoped proofread rules compare rule.sectionHref (a TOC href
    // like "1#b") against detail.name via split('#')[0], so the name must be
    // the bare section index.
    expect(seen[0]?.name).toBe('1');
    expect(seen[0]?.type).toBe('application/xhtml+xml');
  });

  it('caches the transformed content until unload invalidates it', async () => {
    const book = await make('# A\n\nteh text\n');
    const { listener } = attachDisplayTransform(book.transformTarget!, (content) =>
      content.replace(/teh/g, 'the'),
    );
    await book.sections[0]!.loadContent!();
    await book.sections[0]!.loadContent!();
    expect(listener).toHaveBeenCalledTimes(1);
    // Viewer recreation (e.g. after a proofread rule change) destroys the
    // views, which unloads the sections; the next load must re-transform.
    book.sections[0]!.unload!();
    await book.sections[0]!.loadContent!();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('keeps createDocument raw so the TTS transform path does not double-apply', async () => {
    const book = await make('# A\n\nteh text\n');
    attachDisplayTransform(book.transformTarget!, (content) => content.replace(/teh/g, 'the'));
    const doc = await book.sections[0]!.createDocument();
    expect(doc.documentElement.textContent).toContain('teh text');
  });

  it('falls back to the raw content when the transform yields nothing', async () => {
    const book = await make('# A\n\nteh text\n');
    attachDisplayTransform(book.transformTarget!, () => '');
    const content = await book.sections[0]!.loadContent!();
    expect(content).toContain('teh text');
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
