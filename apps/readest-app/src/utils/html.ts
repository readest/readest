import { Readability } from '@mozilla/readability';

import type { BookDoc } from '@/libs/document';
import { buildHtmlBook } from './htmlBook';
import { sanitizeForParsing, sanitizeHtml } from './sanitize';

// Render a standalone HTML page (a SingleFile save, a browser "Save as HTML")
// into an in-memory foliate-js book at runtime, the way makeMarkdownBook does
// for .md: no EPUB conversion. Readability keeps the article and drops the
// page chrome (navigation, sidebars, footers); the images stay, SingleFile
// inlines them as data: URIs which pass through the sanitizer untouched
// (issue #6198).

// SingleFile tags every element that was display:none at save time with this
// class and hides it again through its own stylesheet, which is dropped here.
const SINGLEFILE_HIDDEN_CLASS = 'sf-hidden';

// Readability deletes a <div> that holds fewer than 25 characters of text, and
// MediaWiki wraps each heading in exactly that: <div><h2>…</h2><span>[edit]
// </span></div>. Lift such a heading out of its wrapper (the decoration goes)
// so the heading, and with it its TOC entry, survive extraction.
const liftWrappedHeadings = (doc: Document) => {
  for (const heading of Array.from(doc.querySelectorAll('h1, h2, h3, h4, h5, h6'))) {
    const wrapper = heading.parentElement;
    if (!wrapper || wrapper.tagName !== 'DIV') continue;
    // Only the heading itself may be in there: no second heading, no media.
    const notable = wrapper.querySelectorAll(
      'h1, h2, h3, h4, h5, h6, img, picture, svg, video, audio',
    );
    if (notable.length !== 1) continue;
    const decoration =
      (wrapper.textContent ?? '').trim().length - (heading.textContent ?? '').trim().length;
    if (decoration < 25) wrapper.replaceWith(heading);
  }
};

export async function makeHtmlBook(file: File): Promise<BookDoc> {
  const doc = new DOMParser().parseFromString(sanitizeForParsing(await file.text()), 'text/html');
  const documentTitle = doc.title.trim();
  const language = doc.documentElement.lang.trim() || 'en';
  const dirAttr = (doc.documentElement.getAttribute('dir') || doc.body.getAttribute('dir') || '')
    .trim()
    .toLowerCase();
  const dir = dirAttr === 'rtl' ? 'rtl' : 'ltr';
  for (const el of Array.from(doc.getElementsByClassName(SINGLEFILE_HIDDEN_CLASS))) el.remove();
  liftWrappedHeadings(doc);

  // Readability edits the document in place, so keep the body for the case
  // where it finds no article at all (an image-only page, say).
  const rawBody = doc.body.innerHTML;
  let parsed: { title?: string | null; content?: string | null } | null = null;
  try {
    parsed = new Readability(doc).parse();
  } catch (e) {
    console.warn('Readability failed, rendering the whole page:', e);
  }

  const basename = file.name.replace(/\.(?:html?|xhtml)$/i, '');
  return buildHtmlBook(
    sanitizeHtml(parsed?.content || rawBody),
    {
      // The page's own <title> (cleaned of the site suffix by Readability) is
      // explicit metadata; the filename only stands in when there is none.
      title: parsed?.title?.trim() || documentTitle || basename,
      // Readability's byline guess is not trusted: on a Wikipedia save it
      // returned the "Authority control" box. Empty, like a Markdown file.
      author: '',
      language,
      identifier: file.name,
    },
    null,
    dir,
  );
}
