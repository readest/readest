import { describe, it, expect } from 'vitest';
import { makeHtmlBook } from '@/utils/html';
import type { BookDoc } from '@/libs/document';

// makeHtmlBook returns the same foliate book shape makeMarkdownBook does; the
// BookDoc type does not declare the extra members the tests exercise.
type HtmlBook = BookDoc & {
  toc: NonNullable<BookDoc['toc']>;
  resolveHref: (
    href: string,
  ) => { index: number; anchor: (doc: Document) => Element | null } | null;
  destroy: () => void;
};

const htmlFile = (content: string, name = 'page.html', type = 'text/html') =>
  new File([content], name, { type });

const make = async (content: string, name?: string, type?: string) =>
  (await makeHtmlBook(htmlFile(content, name, type))) as unknown as HtmlBook;

const flattenToc = (items: BookDoc['toc'] = []): NonNullable<BookDoc['toc']> =>
  items.flatMap((i) => [i, ...(i.subitems ? flattenToc(i.subitems) : [])]);

// Readability only trusts a container once it holds a few hundred characters
// of prose, so every article fixture pads its sections with this.
const prose = (n = 6) =>
  `<p>${'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor. '.repeat(n)}</p>`;

// A 1x1 GIF, the shape SingleFile leaves every image in: inlined as a data URI.
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const page = (body: string, head = '<title>Pamir Mountains</title>') =>
  `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">${head}</head><body>${body}</body></html>`;

const ARTICLE = `
  <nav><ul><li><a href="/">Home</a></li><li><a href="/about">About</a></li></ul></nav>
  <article>
    <h1>Pamir Mountains</h1>
    ${prose()}
    <h2 id="Geography">Geography</h2>
    ${prose()}
    <figure><img src="${PIXEL}" alt="A peak"><figcaption>A peak</figcaption></figure>
    ${prose()}
    <h2 id="Economy">Economy</h2>
    ${prose()}
  </article>
  <footer><p>Site footer boilerplate</p></footer>`;

describe('makeHtmlBook', () => {
  it('keeps the article and its images, drops the page chrome', async () => {
    const book = await make(page(ARTICLE));
    const doc = await book.sections[0]!.createDocument();
    expect(doc.querySelector('parsererror')).toBeNull();
    const text = doc.body.textContent ?? '';
    expect(text).toContain('Lorem ipsum');
    expect(text).not.toContain('Home');
    expect(text).not.toContain('Site footer boilerplate');
    const img = doc.querySelector('img');
    expect(img?.getAttribute('src')).toBe(PIXEL);
    expect(img?.getAttribute('alt')).toBe('A peak');
    expect(doc.querySelector('figcaption')?.textContent).toBe('A peak');
    expect(doc.querySelector('script')).toBeNull();
  });

  it('builds the TOC from the surviving headings and resolves their anchors', async () => {
    const book = await make(page(ARTICLE));
    const labels = flattenToc(book.toc).map((i) => i.label);
    expect(labels).toEqual(expect.arrayContaining(['Geography', 'Economy']));
    const geography = flattenToc(book.toc).find((i) => i.label === 'Geography')!;
    expect(geography.href).toBe('0#Geography');
    const doc = await book.sections[0]!.createDocument();
    expect(book.resolveHref('#Geography')?.anchor(doc)?.textContent).toBe('Geography');
  });

  it('takes the title and language from the document and leaves the author empty', async () => {
    // Readability's byline guess is ignored: it picked Wikipedia's "Authority
    // control" box as the author on the issue's own sample.
    const body = ARTICLE.replace(
      '<h1>Pamir Mountains</h1>',
      '<h1>Pamir Mountains</h1><p class="byline">Jane Doe</p>',
    );
    const book = await make(page(body));
    expect(book.metadata.title).toBe('Pamir Mountains');
    expect(book.metadata.author).toBe('');
    expect(book.metadata.language).toBe('de');
  });

  it('titles the book after the file when the page has no title', async () => {
    const body = `<article>${prose()}<p>Plain text with no heading.</p>${prose()}</article>`;
    const book = await make(page(body, ''), 'saved-page.htm');
    expect(book.metadata.title).toBe('saved-page');
    expect(book.metadata.identifier).toBe('saved-page.htm');
  });

  it('keeps headings that sit in a short wrapper div beside an edit link (MediaWiki)', async () => {
    // Readability scores <div><h2>Geography</h2><span>[edit]</span></div> as a
    // suspiciously short block and deletes it, heading included.
    const heading = (id: string, label: string) =>
      `<div class="mw-heading mw-heading2"><h2 id="${id}">${label}</h2>` +
      `<span class="mw-editsection"><span class="mw-editsection-bracket">[</span>` +
      `<a href="https://example.org/edit">edit</a><span class="mw-editsection-bracket">]</span></span></div>`;
    const body = `<main>${prose()}${heading('Geography', 'Geography')}${prose()}${heading(
      'Economy',
      'Economy',
    )}${prose()}</main>`;
    const book = await make(page(body));
    const labels = flattenToc(book.toc).map((i) => i.label);
    expect(labels).toEqual(['Geography', 'Economy']);
    const doc = await book.sections[0]!.createDocument();
    expect(doc.body.textContent).not.toMatch(/\bedit\b/);
  });

  it('leaves a wrapper div alone when it holds more than the heading', async () => {
    const body =
      `<main>${prose()}<div><h2 id="Gallery">Gallery</h2><img src="${PIXEL}" alt="one">` +
      `<p>A caption long enough not to be decoration around the heading.</p></div>${prose()}</main>`;
    const book = await make(page(body));
    const doc = await book.sections[0]!.createDocument();
    expect(doc.querySelector('img')?.getAttribute('alt')).toBe('one');
    expect(flattenToc(book.toc).map((i) => i.label)).toEqual(['Gallery']);
  });

  it('drops the elements SingleFile saved as hidden', async () => {
    const body = `<article>${prose()}<p class="sf-hidden">HIDDEN AT SAVE TIME</p>${prose()}</article>`;
    const book = await make(page(body));
    const doc = await book.sections[0]!.createDocument();
    expect(doc.body.textContent).not.toContain('HIDDEN AT SAVE TIME');
  });

  it('falls back to the whole body when Readability finds no article', async () => {
    const book = await make(page(`<img src="${PIXEL}" alt="only an image">`));
    const doc = await book.sections[0]!.createDocument();
    expect(doc.querySelector('img')?.getAttribute('alt')).toBe('only an image');
  });

  it('strips scripts and event handlers', async () => {
    const body = `<article>${prose()}<script>alert(1)</script><p onclick="steal()">Click <b>me</b></p>${prose()}</article>`;
    const book = await make(page(body));
    const doc = await book.sections[0]!.createDocument();
    expect(doc.querySelector('script')).toBeNull();
    expect(doc.querySelector('[onclick]')).toBeNull();
    expect(doc.body.textContent).toContain('Click me');
  });

  it('keeps a right-to-left document right-to-left', async () => {
    const rtl = `<!DOCTYPE html><html lang="ar" dir="RTL"><head><title>عنوان</title></head><body>${ARTICLE}</body></html>`;
    const book = await make(rtl);
    expect(book.dir).toBe('rtl');
    const doc = await book.sections[0]!.createDocument();
    expect(doc.documentElement.getAttribute('dir')).toBe('rtl');
    const ltr = await make(page(ARTICLE));
    expect(ltr.dir).toBe('ltr');
  });

  it('renames repeated ids so every TOC entry keeps its own anchor', async () => {
    const body = `<main>${prose()}<h2 id="notes">Notes A</h2>${prose()}<h2 id="notes">Notes B</h2>${prose()}<p id="notes-1">reserved</p>${prose()}</main>`;
    const book = await make(page(body));
    const hrefs = flattenToc(book.toc).map((i) => i.href);
    expect(hrefs.length).toBe(2);
    expect(new Set(hrefs).size).toBe(2);
    const doc = await book.sections[0]!.createDocument();
    for (const item of flattenToc(book.toc)) {
      const anchor = book
        .resolveHref(item.href.split('#')[1] ? '#' + item.href.split('#')[1] : item.href)
        ?.anchor(doc);
      expect(anchor?.textContent).toBe(item.label);
    }
    // The generated name must not collide with an id the document already had.
    expect(doc.getElementById('notes-1')?.textContent).toBe('reserved');
  });

  it('gives each section a CFI base and a blob URL, and revokes it on destroy', async () => {
    const created: string[] = [];
    const revoked: string[] = [];
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = () => {
      const url = `blob:test/${created.length}`;
      created.push(url);
      return url;
    };
    URL.revokeObjectURL = (url: string) => {
      revoked.push(url);
    };
    try {
      const book = await make(page(ARTICLE));
      const section = book.sections[0] as BookDoc['sections'][number] & { load: () => string };
      expect(section.cfi).toBeTruthy();
      expect(section.load()).toBe('blob:test/0');
      book.destroy();
      expect(revoked).toEqual(['blob:test/0']);
    } finally {
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
    }
  });
});
