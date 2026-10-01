import type { CalibreBookJson } from '@/types/calibre';
import type { CalibreServerBook } from '@/services/calibre/librarySync';

/**
 * Minimal parser for Calibre-Web's OPDS acquisition feeds
 * (cps/templates/feed.xml). The feed is machine-generated, but entries mix
 * structured fields (title, authors, categories) with display-only blobs
 * (rating/series are rendered INTO the xhtml content), so the extraction
 * mirrors what the template actually emits:
 *
 *   <id>urn:uuid:{uuid}</id>                 — the calibre UUID, NOT the id
 *   <link rel=".../acquisition"
 *         href="/opds/download/{id}/{fmt}/"  — carries the NUMERIC book id
 *         title="{FORMAT}">                  — and the format name
 *   <link rel=".../image" href="/opds/cover/{id}">
 *   <content type="xhtml">RATING: ★★<br/> TAGS: ... SERIES: Name [2.0] <p>comment</p></content>
 *
 * Navigation feeds (the /opds root) render the same template without
 * acquisition links; those entries are skipped. Pagination rides the
 * rel="next" link's `?offset=` (calibre-web derives the page from
 * offset/books-per-page, so the exact server-computed href must be used,
 * not an offset we invent).
 */
export interface CalibreWebFeed {
  entries: CalibreServerBook[];
  /** href of the rel="next" link, when the feed has another page. */
  nextHref?: string;
}

const ACQUISITION_REL = 'http://opds-spec.org/acquisition';
const DOWNLOAD_HREF = /\/opds\/download\/(\d+)\/([^/?#]+)/;

/**
 * Strict XML rejects things Calibre-Web's feed template happily emits, most
 * notoriously raw book-comment HTML injected with `|safe` into the Atom
 * document (`&nbsp;`, bare `&`, undefined named entities). Clean what is
 * cleanly cleanable — control characters and known non-XML named entities —
 * parse as XML, and fall back to the forgiving HTML parser. The extraction
 * below works against both trees: prefix-less lookups (`entry`, `link`,
 * `content`, ...) behave the same, and namespaced `dcterms:language` is
 * matched by candidates since HTML mode keeps the prefix in nodeName (and
 * drops the self-closing slash on unknown elements like `<category/>`, which
 * only re-nests later siblings the descendant searches still reach).
 */
const XML_ILLEGAL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;
const HTML_ENTITY = /&([a-zA-Z][a-zA-Z0-9]*);/g;
const NAMED_ENTITIES: Record<string, string> = {
  nbsp: '\u00A0',
  mdash: '\u2014',
  ndash: '\u2013',
  hellip: '\u2026',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201C',
  rdquo: '\u201D',
  copy: '\u00A9',
  reg: '\u00AE',
  trade: '\u2122',
  deg: '\u00B0',
  plusmn: '\u00B1',
  times: '\u00D7',
  divide: '\u00F7',
  eacute: '\u00E9',
  egrave: '\u00E8',
  agrave: '\u00E0',
  ccedil: '\u00E7',
  uuml: '\u00FC',
  ouml: '\u00F6',
  auml: '\u00E4',
  szlig: '\u00DF',
};

const parseFeedDocument = (xml: string): Document => {
  const cleaned = xml
    .replace(XML_ILLEGAL_CHARS, '')
    .replace(HTML_ENTITY, (whole, name: string) => NAMED_ENTITIES[name] ?? whole);
  const strict = new DOMParser().parseFromString(cleaned, 'text/xml');
  if (
    strict.documentElement?.localName === 'feed' &&
    strict.getElementsByTagName('parsererror').length === 0
  ) {
    return strict;
  }
  // Recovery mode: the HTML parser accepts bare `&`, unknown entities, and
  // tag soup. A document that isn't a feed at all (the login page) is
  // rejected by the caller's root check.
  return new DOMParser().parseFromString(cleaned, 'text/html');
};

/** Elements by local name across both XML and HTML parser trees. */
const elementsNamed = (root: Element | Document, ...names: string[]): Element[] =>
  Array.from(root.getElementsByTagName('*')).filter((el) => {
    const nodeName = el.nodeName;
    const localName = el.localName;
    return names.some((name) => localName === name || nodeName === name);
  });

const textOf = (element: Element, tag: string): string => {
  const el = elementsNamed(element, tag)[0];
  return el?.textContent?.trim() ?? '';
};

export const parseCalibreWebFeed = (xml: string): CalibreWebFeed => {
  const doc = parseFeedDocument(xml);
  // The HTML parser wraps everything in <html>, so the feed element may not
  // be the documentElement — find it wherever it lives.
  const root =
    doc.documentElement?.localName === 'feed' ? doc.documentElement : elementsNamed(doc, 'feed')[0];
  if (!root) {
    // A 302 into the login page (OPDS basic auth disabled) surfaces here.
    throw new Error(
      'Calibre-Web OPDS feed not found. Enable OPDS and basic authentication on the server.',
    );
  }

  const nextHref =
    elementsNamed(root, 'link')
      .find((link) => link.getAttribute('rel') === 'next')
      ?.getAttribute('href') ?? undefined;

  const entries: CalibreServerBook[] = [];
  for (const entry of elementsNamed(root, 'entry')) {
    const links = elementsNamed(entry, 'link');
    const acquisitions = links.filter((link) => link.getAttribute('rel') === ACQUISITION_REL);
    if (acquisitions.length === 0) continue; // navigation entry

    let bookId: string | undefined;
    const formats: string[] = [];
    for (const link of acquisitions) {
      const match = (link.getAttribute('href') ?? '').match(DOWNLOAD_HREF);
      if (!match) continue;
      bookId = bookId ?? match[1]!;
      // The link title is the format name (EPUB, MOBI, ...); the href's last
      // segment is the same lowercased. Prefer the title, fall back to href.
      const fmt = (link.getAttribute('title') ?? match[2] ?? '').toLowerCase();
      if (fmt && !formats.includes(fmt)) formats.push(fmt);
    }
    if (!bookId || formats.length === 0) continue;

    const json: CalibreBookJson = {
      title: textOf(entry, 'title') || 'Untitled',
      authors: elementsNamed(entry, 'author')
        .map((author) => textOf(author, 'name'))
        .filter(Boolean),
      formats,
      last_modified: textOf(entry, 'updated') || undefined,
      pubdate: textOf(entry, 'published') || undefined,
      languages: elementsNamed(entry, 'language', 'dcterms:language')
        .map((lang) => lang.textContent?.trim() ?? '')
        .filter(Boolean),
      tags: elementsNamed(entry, 'category').length
        ? elementsNamed(entry, 'category')
            .map((category) => category.getAttribute('term') ?? '')
            .filter(Boolean)
        : null,
      publisher: textOf(entry, 'publisher') || null,
      thumbnail:
        links
          .find((link) => (link.getAttribute('rel') ?? '').startsWith('http://opds-spec.org/image'))
          ?.getAttribute('href') ?? undefined,
    };

    // Rating/series/description only exist inside the xhtml content blob.
    const content = elementsNamed(entry, 'content')[0]?.textContent ?? '';
    const stars = content.match(/RATING:\s*([★]+)/);
    if (stars) json.rating = stars[1]!.length;
    const series = content.match(/SERIES:\s*(.+?)\s*\[([^\]]+)\]/);
    if (series) {
      json.series = series[1]!.trim();
      const index = Number.parseFloat(series[2]!);
      if (!Number.isNaN(index)) json.series_index = index;
    }
    const paragraphs = elementsNamed(entry, 'p');
    if (paragraphs.length > 0) {
      json.comments = paragraphs
        .map((p) => p.innerHTML?.trim() ?? p.textContent?.trim() ?? '')
        .filter(Boolean)
        .join('<br/>');
    }

    entries.push({ id: bookId, json });
  }

  return { entries, nextHref };
};

export interface CalibreWebNavEntry {
  /** First capture group of `hrefPattern` applied to the entry's link. */
  id: string;
  title: string;
  href: string;
}

/**
 * Extract navigation entries from a Calibre-Web nav feed (e.g.
 * /opds/shelfindex): entries whose subsection href matches `hrefPattern`.
 * Calibre-Web renders nav entries with the target URL as both <id> and the
 * subsection link, so the href is the only reliable identifier carrier.
 */
export const parseCalibreWebNav = (
  xml: string,
  hrefPattern: RegExp,
): { links: CalibreWebNavEntry[]; nextHref?: string } => {
  const doc = parseFeedDocument(xml);
  const root =
    doc.documentElement?.localName === 'feed' ? doc.documentElement : elementsNamed(doc, 'feed')[0];
  if (!root) {
    throw new Error(
      'Calibre-Web OPDS feed not found. Enable OPDS and basic authentication on the server.',
    );
  }

  const nextHref =
    elementsNamed(root, 'link')
      .find((link) => link.getAttribute('rel') === 'next')
      ?.getAttribute('href') ?? undefined;

  const links: CalibreWebNavEntry[] = [];
  for (const entry of elementsNamed(root, 'entry')) {
    const link = elementsNamed(entry, 'link').find((l) =>
      hrefPattern.test(l.getAttribute('href') ?? ''),
    );
    const href = link?.getAttribute('href');
    if (!href) continue;
    const match = href.match(hrefPattern);
    if (!match?.[1]) continue;
    links.push({ id: match[1], title: textOf(entry, 'title'), href });
  }

  return { links, nextHref };
};
