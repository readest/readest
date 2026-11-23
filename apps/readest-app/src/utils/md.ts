import katex from 'katex';
import { Marked, type TokenizerAndRendererExtension } from 'marked';
import markedFootnote from 'marked-footnote';
import markedKatex from 'marked-katex-extension';

import type { BookDoc, BookMetadata } from '@/libs/document';
import { buildHtmlBook } from './htmlBook';
import {
  FOOTNOTE_PREFIX_ID,
  expandInlineFootnotes,
  normalizeFootnoteDefinitionIndent,
} from './mdFootnotes';
import { frontmatterToMetadata, parseFrontmatter } from './mdFrontmatter';
import { sanitizeHtml } from './sanitize';

// Render a standalone Markdown (.md) file into an in-memory foliate-js book at
// runtime (no EPUB conversion); see utils/htmlBook.ts for the book contract.

// A scoped parser: `marked` itself is a shared singleton also imported by the
// annotation note renderer and the export dialog, and must not gain footnote
// parsing as a side effect.
// Math renders as MathML, since no KaTeX stylesheet is loaded in the book.
const KATEX_OPTIONS = { throwOnError: false, output: 'mathml' } as const;

// Inline math takes Pandoc's rule for `$…$`: a non-space right inside each `$`
// and no digit right after the closing one, so prices like `$5 and $10` stay
// text. No space is needed before the opening `$`, so CJK text like
// `（记为 $N_T$）` renders (issue #6870). `$$…$$` is display math anywhere.
const INLINE_MATH =
  /^\$\$(?!\$)((?:\\.|[^\\\n])*?(?:\\.|[^\\\n$]))\$\$|^\$(?![\s$])((?:\\.|[^\\\n$])*?(?:\\.|[^\\\s$]))\$(?!\d)/;

const inlineMath: TokenizerAndRendererExtension = {
  name: 'inlineMath',
  level: 'inline',
  // Only where math opens: a `$` run that opens none (`$$$x$$$`) is skipped
  // whole, or its `$$x$$` tail would be retried one `$` later.
  start: (src) => {
    for (let index = src.indexOf('$'); index >= 0; ) {
      const rest = src.slice(index);
      if (INLINE_MATH.test(rest)) return index;
      index = src.indexOf('$', index + (/^\$+/.exec(rest)?.[0].length ?? 1));
    }
    return undefined;
  },
  tokenizer: (src) => {
    const match = INLINE_MATH.exec(src);
    if (!match) return undefined;
    const displayMode = match[1] !== undefined;
    const text = (displayMode ? match[1] : match[2]) ?? '';
    return { type: 'inlineMath', raw: match[0], text: text.trim(), displayMode };
  },
  renderer: (token) =>
    katex.renderToString(token['text'] as string, {
      ...KATEX_OPTIONS,
      displayMode: token['displayMode'] as boolean,
    }),
};

// The extension's block rule (`$$` on lines of their own) is kept; its inline
// rule is replaced by the one above.
const blockMath = markedKatex(KATEX_OPTIONS).extensions?.filter(
  (extension) => extension.name === 'blockKatex',
);

const markdown = new Marked({ gfm: true }).use(
  markedFootnote({ prefixId: FOOTNOTE_PREFIX_ID }),
  { extensions: [...(blockMath ?? []), inlineMath] },
  {
    hooks: { preprocess: (src) => expandInlineFootnotes(normalizeFootnoteDefinitionIndent(src)) },
  },
);

export async function makeMarkdownBook(file: File): Promise<BookDoc> {
  const text = await file.text();
  // The frontmatter block is stripped before rendering so it does not show up
  // as a stray `<hr>` + text; its keys become the book's metadata (issue #5279).
  const { body, fields } = parseFrontmatter(text);
  const { metadata: frontmatter, coverBlob } = frontmatterToMetadata(fields);
  const rawHtml = await markdown.parse(body);

  // The filename is the title unless frontmatter — an explicit metadata block —
  // says otherwise. A heading is body content: preferring the first <h1> made
  // every note whose first line is a heading import under that heading instead
  // of its own name, and the <h1> was matched by tag name rather than position,
  // so one buried mid-document could win even when the file opened with an <h2>.
  const title = frontmatter.title || file.name.replace(/\.(?:md|markdown)$/i, '');

  return buildHtmlBook(
    sanitizeHtml(rawHtml, { mathMl: true }),
    {
      author: '',
      language: '',
      ...frontmatter,
      title,
      // A frontmatter identifier — an explicit one, else the ISBN — makes the
      // same book import to the same `metaHash` from any copy of the file. With
      // neither, the filename stays the identifier, so books already in the
      // library keep the hash they were imported under.
      identifier: frontmatter.identifier || frontmatter.isbn || file.name,
      // Frontmatter may list several authors; the import formats the array.
    } as BookMetadata,
    coverBlob,
  );
}
