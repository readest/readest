import DOMPurify from 'dompurify';

/**
 * Strip untrusted HTML (from email bodies, web pages, DOCX conversion) down to
 * safe, EPUB-appropriate structural markup. Removes scripts, event handlers,
 * styles, iframes, and form controls; keeps headings, text, lists, tables,
 * links and images.
 *
 * Runs against the real DOM — Send to Readest converts on the client (browser
 * or Tauri webview), both of which provide `window`/`DOMParser`.
 */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'p',
      'br',
      'hr',
      'blockquote',
      'pre',
      'code',
      'strong',
      'em',
      'b',
      'i',
      'u',
      's',
      'sup',
      'sub',
      'span',
      'ul',
      'ol',
      'li',
      'dl',
      'dt',
      'dd',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
      'a',
      'img',
      'figure',
      'figcaption',
    ],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'colspan', 'rowspan'],
    // Drop anything that would load or run remote code.
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input'],
    FORBID_ATTR: ['srcset'],
    ALLOW_DATA_ATTR: false,
  });
}

/**
 * Strip scripts and event handlers from an untrusted *document* before it is
 * handed to `DOMParser`. Unlike `sanitizeHtml`, this keeps the document
 * structure (`<head>`, `<title>`, sectioning elements) so title extraction and
 * Readability still work — it only removes anything executable.
 */
export function sanitizeForParsing(html: string): string {
  return DOMPurify.sanitize(html, { WHOLE_DOCUMENT: true });
}
