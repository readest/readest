import { Marked } from 'marked';
import markedFootnote from 'marked-footnote';

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
const markdown = new Marked({ gfm: true }).use(markedFootnote({ prefixId: FOOTNOTE_PREFIX_ID }), {
  hooks: { preprocess: (src) => expandInlineFootnotes(normalizeFootnoteDefinitionIndent(src)) },
});

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
    sanitizeHtml(rawHtml),
    {
      author: '',
      language: 'en',
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
