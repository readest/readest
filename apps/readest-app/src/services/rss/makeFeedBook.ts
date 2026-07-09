import type { BookDoc, SectionItem } from '@/libs/document';
import { CFI } from '@/libs/document';
import { sanitizeHtml } from '@/utils/sanitize';
import type { FeedManifest, FeedArticleEntry } from './feedManifest';

const XHTML_NS = 'http://www.w3.org/1999/xhtml';

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const FEED_STYLE = `
img { max-width: 100%; height: auto; }
pre { white-space: pre-wrap; overflow-wrap: break-word; }
pre, code { font-family: monospace; }
table { border-collapse: collapse; }
th, td { border: 1px solid currentColor; padding: 0.2em 0.5em; }
blockquote { margin-inline: 1em; }
`;

const wrapXhtml = (inner: string): string =>
  '<?xml version="1.0" encoding="utf-8"?>\n' +
  `<html xmlns="${XHTML_NS}"><head><meta charset="utf-8"/><style>${FEED_STYLE}</style></head><body>${inner}</body></html>`;

const isExternalUri = (uri: string): boolean => /^(?:https?|mailto|tel):/i.test(uri);

type FeedSection = SectionItem & { load: () => string };

export async function makeFeedBook(
  manifest: FeedManifest,
  loadArticleHtml: (entry: FeedArticleEntry) => Promise<string>,
): Promise<BookDoc> {
  const htmls = await Promise.all(manifest.entries.map((e) => loadArticleHtml(e)));

  const serializer = new XMLSerializer();

  const xhtml = manifest.entries.map((entry, i) => {
    const rawHtml = htmls[i]!;
    const safeHtml = sanitizeHtml(rawHtml);
    const docBody = new DOMParser().parseFromString(safeHtml, 'text/html').body;
    const inner = Array.from(docBody.childNodes)
      .map((n) => serializer.serializeToString(n))
      .join('');
    const h1 = `<h1>${escapeHtml(entry.title)}</h1>`;
    return wrapXhtml(h1 + inner);
  });

  const urls: (string | undefined)[] = new Array(xhtml.length).fill(undefined);

  const sections: FeedSection[] = manifest.entries.map((entry, index) => {
    const str = xhtml[index]!;
    return {
      id: String(entry.slot),
      cfi: CFI.fake.fromIndex(entry.slot),
      size: new TextEncoder().encode(str).length,
      linear: 'yes',
      load: () => {
        if (urls[index] === undefined) {
          urls[index] = URL.createObjectURL(new Blob([str], { type: 'application/xhtml+xml' }));
        }
        return urls[index]!;
      },
      loadText: async () => str,
      createDocument: async () => new DOMParser().parseFromString(str, 'application/xhtml+xml'),
    };
  });

  const toc = manifest.entries.map((e) => ({ label: e.title, href: String(e.slot) }));

  const book = {
    metadata: {
      title: manifest.title,
      author: '',
      language: 'en',
      identifier: manifest.feedUrl,
    },
    rendition: { layout: 'reflowable' as const },
    dir: 'ltr',
    toc,
    sections,
    splitTOCHref: (href: string): string[] => (href ? href.split('#') : []),
    getTOCFragment: (doc: Document, id: string): Element | null => doc.getElementById(id),
    resolveHref: (href: string) => {
      const [a, b] = href.split('#');
      if (a) {
        const slot = Number(a);
        const index = sections.findIndex((s) => s.id === String(slot));
        if (index < 0) return null;
        return { index, anchor: (doc: Document) => (b ? doc.getElementById(b) : null) };
      }
      return null;
    },
    isExternal: (uri: string): boolean => isExternalUri(uri),
    getCover: async (): Promise<Blob | null> => null,
    destroy: () => {
      for (const url of urls) if (url) URL.revokeObjectURL(url);
    },
  };

  return book as unknown as BookDoc;
}
