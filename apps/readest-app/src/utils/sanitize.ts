import DOMPurify from 'dompurify';

export const sanitizeString = (str?: string) => {
  if (!str) return str;
  return str.replace(/\u0000/g, '');
};

/**
 * Strip untrusted HTML (Send-to-Readest email/web/DOCX conversion, OPDS feed
 * descriptions, etc.) down to safe, EPUB-appropriate structural markup. Removes
 * scripts, event handlers, styles, iframes, and form controls; keeps headings,
 * text, lists, tables, links and images.
 *
 * Runs against the real DOM, so callers must be on the client (browser or Tauri
 * webview), both of which provide `window`/`DOMParser`.
 */
// The MathML KaTeX emits for Markdown math (utils/md.ts).
const MATHML_TAGS = [
  'math',
  'semantics',
  'annotation',
  'mrow',
  'mi',
  'mn',
  'mo',
  'mtext',
  'mspace',
  'msup',
  'msub',
  'msubsup',
  'mfrac',
  'msqrt',
  'mroot',
  'mover',
  'munder',
  'munderover',
  'mtable',
  'mtr',
  'mtd',
  'mstyle',
  'mpadded',
  'mphantom',
  'menclose',
  'mglyph',
];
const MATHML_ATTR = [
  'display',
  'encoding',
  'mathvariant',
  'stretchy',
  'fence',
  'separator',
  'lspace',
  'rspace',
  'accent',
  'accentunder',
  'largeop',
  'minsize',
  'maxsize',
  'linethickness',
  'scriptlevel',
  'displaystyle',
  'width',
  'height',
  'depth',
  'voffset',
  'columnalign',
  'columnlines',
  'columnspacing',
  'rowlines',
  'rowspacing',
  'notation',
  'mathcolor',
  'mathbackground',
  'mathsize',
];

export function sanitizeHtml(html: string, { mathMl = false } = {}): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      ...(mathMl ? MATHML_TAGS : []),
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
      'del',
      'ins',
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
      // Markdown footnote definitions arrive wrapped in <section class="footnotes">
      // (see utils/mdFootnotes.ts), which must survive to be found and re-emitted.
      'section',
    ],
    // `id` is allowed so heading anchors survive — the EPUB's nested
    // navMap uses `chapter1.xhtml#heading-id` to link the TOC sidebar to
    // each section. Without it readers see one entry per chapter only.
    // `class` is allowed so Markdown code fences keep their `language-*`
    // class for theming (see utils/md.ts).
    ALLOWED_ATTR: [
      'href',
      'src',
      'alt',
      'title',
      'colspan',
      'rowspan',
      'id',
      'class',
      ...(mathMl ? MATHML_ATTR : []),
    ],
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
