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

// A page saved by Chrome's "Save as… Webpage, Single File": a MIME
// multipart/related archive, the HTML quoted-printable and every image a
// base64 part addressed by its original URL (issue #6413).
describe('makeHtmlBook with an MHTML archive', () => {
  const BOUNDARY = '----MultipartBoundary--Xy12----';

  // Soft line breaks after every tag exercise the "=\r\n" continuation.
  const qp = (s: string) =>
    Array.from(new TextEncoder().encode(s), (b) =>
      b === 0x3d || b > 0x7e ? `=${b.toString(16).toUpperCase()}` : String.fromCharCode(b),
    )
      .join('')
      .replace(/>/g, '>=\r\n');

  const part = (headers: string[], body: string) =>
    [`--${BOUNDARY}`, ...headers, '', body, ''].join('\r\n');

  const archive = (html: string) =>
    [
      'From: <Saved by Blink>',
      'Snapshot-Content-Location: https://example.com/wiki/Pamir',
      'Subject: Pamir',
      'MIME-Version: 1.0',
      'Content-Type: multipart/related;',
      '\ttype="text/html";',
      `\tboundary="${BOUNDARY}"`,
      '',
      '',
      part(
        [
          'Content-Type: text/html',
          'Content-ID: <frame-1@mhtml.blink>',
          'Content-Transfer-Encoding: quoted-printable',
          'Content-Location: https://example.com/wiki/Pamir',
        ],
        qp(html),
      ),
      part(
        [
          'Content-Type: image/gif',
          'Content-Transfer-Encoding: base64',
          'Content-Location: https://example.com/img/peak.gif',
        ],
        'AAAA\r\nAAAA',
      ),
      part(
        [
          'Content-Type: image/png',
          'Content-Transfer-Encoding: base64',
          'Content-Location: https://example.com/img/lake.png',
        ],
        'BBBB',
      ),
      part(
        ['Content-Type: image/jpeg', 'Content-Transfer-Encoding: base64', 'Content-ID: <logo@x>'],
        'CCCC',
      ),
      `--${BOUNDARY}--`,
      '',
    ].join('\r\n');

  const MHTML_ARTICLE = ARTICLE.replace(
    `<figure><img src="${PIXEL}" alt="A peak">`,
    `<figure><img src="https://example.com/img/peak.gif" srcset="https://example.com/img/peak-2x.gif 2x" alt="A peak">
     <img src="../img/lake.png" alt="A lake"><img src="cid:logo@x" alt="A logo">
     <img src="https://example.com/img/missing.gif" alt="Not saved">`,
  ).replace('<h1>Pamir Mountains</h1>', '<h1>Pamir Mountains</h1><p>Die Berge über dem Tal.</p>');

  const MHTML = archive(page(MHTML_ARTICLE, '<title>Pamir über alles</title>'));

  it('decodes the HTML part and inlines the archived images', async () => {
    const book = await make(MHTML, 'Pamir.mhtml', '');
    expect(book.metadata.title).toBe('Pamir über alles');
    const doc = await book.sections[0]!.createDocument();
    expect(doc.body.textContent).toContain('Die Berge über dem Tal.');
    expect(doc.body.textContent).toContain('Lorem ipsum');
    const src = (alt: string) => doc.querySelector(`img[alt="${alt}"]`)?.getAttribute('src');
    expect(src('A peak')).toBe('data:image/gif;base64,AAAAAAAA');
    expect(doc.querySelector('img[alt="A peak"]')?.hasAttribute('srcset')).toBe(false);
    expect(src('A lake')).toBe('data:image/png;base64,BBBB');
    expect(src('A logo')).toBe('data:image/jpeg;base64,CCCC');
    expect(src('Not saved')).toBe('https://example.com/img/missing.gif');
  });

  it('recognizes the archive by its content, whatever the file is named', async () => {
    // The library stores an imported page under the HTML format's .html name.
    const book = await make(MHTML, 'Pamir.html');
    expect(book.metadata.title).toBe('Pamir über alles');
  });

  it('titles the book after the .mht file when the page has no title', async () => {
    const book = await make(
      archive(page(ARTICLE.replace('<h1>Pamir Mountains</h1>', ''), '')),
      'Saved Page.mht',
      '',
    );
    expect(book.metadata.title).toBe('Saved Page');
  });

  it('reads a long header block, splits only at delimiter lines, and resolves part URLs against the message', async () => {
    const html = page(
      `<article><h1>Archive</h1><!--banner-->${prose()}<p><img src="../archive/pics/a.gif" alt="A"></p>${prose()}</article>`,
      '<title>Archive</title>',
    );
    const book = await make(
      [
        `Subject: ${'x'.repeat(10000)}`,
        'Content-Location: https://example.com/archive/',
        'Content-Type: multipart/related; boundary="b"',
        '',
        '--b',
        'Content-Type: text/html',
        'Content-Location: https://example.com/dir/page',
        '',
        html,
        '--b',
        'Content-Type: image/gif',
        'Content-Transfer-Encoding: base64',
        'Content-Location: pics/a.gif',
        '',
        'AAAA',
        '--b--',
      ].join('\r\n'),
      'archive.mhtml',
      '',
    );
    expect(book.metadata.title).toBe('Archive');
    const doc = await book.sections[0]!.createDocument();
    expect(doc.body.textContent).toContain('Lorem ipsum');
    expect(doc.querySelector('img[alt="A"]')?.getAttribute('src')).toBe(
      'data:image/gif;base64,AAAA',
    );
  });

  it('resolves the page against the message location when the page part has none', async () => {
    const html = page(
      `<article><h1>Archive</h1>${prose()}<p><img src="pics/a.gif" alt="A"></p>${prose()}</article>`,
    );
    const book = await make(
      [
        'Content-Location: https://example.com/archive/',
        'Content-Type: multipart/related; boundary="b"',
        '',
        '--b',
        'Content-Type: text/html',
        '',
        html,
        '--b',
        'Content-Type: image/gif',
        'Content-Transfer-Encoding: base64',
        'Content-Location: pics/a.gif',
        '',
        'AAAA',
        '--b--',
      ].join('\r\n'),
      'archive.mhtml',
      '',
    );
    const doc = await book.sections[0]!.createDocument();
    expect(doc.querySelector('img[alt="A"]')?.getAttribute('src')).toBe(
      'data:image/gif;base64,AAAA',
    );
  });

  it('rejects an archive without an HTML page instead of rendering the MIME text', async () => {
    const mhtml = [
      'Content-Type: multipart/related; boundary="b"',
      '',
      '--b',
      'Content-Type: image/gif',
      '',
      'GIF',
      '--b--',
    ].join('\r\n');
    await expect(make(mhtml, 'images.mhtml', '')).rejects.toThrow(/no HTML page/);
  });
});
