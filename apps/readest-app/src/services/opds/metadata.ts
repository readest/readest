import type { Book } from '@/types/book';
import type { BookMetadata } from '@/libs/document';
import type { OPDSPublication, OPDSSubject } from '@/types/opds';
import { SYMBOL } from '@/types/opds';
import { getOPDSDescriptionHtml } from '@/app/opds/utils/opdsContent';
import { formatAuthors, formatTitle, getPrimaryLanguage } from '@/utils/book';
import { normalizeMetadataIsbn } from '@/utils/isbn';

/**
 * BookMetadata subset an OPDS entry can provide. Mirrors MarkdownMetadata's
 * widening of `author`: a feed with several <author> entries stays a list of
 * names (formatAuthors handles both shapes).
 */
export type OPDSBookMetadata = Omit<Partial<BookMetadata>, 'author'> & {
  author?: string | string[];
};

// Atom parses persons to {name, links}; OPDS 2.0 JSON is cast unparsed, so
// authors/publishers there may be plain strings or a single object.
type PersonLike = string | { name?: string } | undefined;

const personNames = (value: PersonLike | PersonLike[] | undefined): string[] => {
  const values = Array.isArray(value) ? value : [value];
  return values.map((v) => (typeof v === 'string' ? v : (v?.name ?? '')).trim()).filter(Boolean);
};

const subjectNames = (value: string | OPDSSubject | Array<string | OPDSSubject> | undefined) => {
  if (!value) return [];
  const values = Array.isArray(value) ? value : [value];
  return values
    .map((s) => (typeof s === 'string' ? s : s?.name || s?.code || '').trim())
    .filter(Boolean);
};

/**
 * The BookMetadata fields an OPDS entry advertises for itself. Catalogs that
 * let users curate metadata (Calibre-Web Automated and friends) publish the
 * curated record in the feed while the EPUB/PDF file still carries the
 * original, so these are the values the library should show (issue #5270).
 * Only fields the feed actually provides are emitted — blanks and empty lists
 * are "not provided", never overrides.
 */
export const getOPDSBookMetadata = (publication: {
  metadata?: OPDSPublication['metadata'];
}): OPDSBookMetadata => {
  const meta = publication.metadata;
  if (!meta) return {};
  const result: OPDSBookMetadata = {};

  const title = meta.title?.trim();
  if (title) result.title = title;
  const subtitle = meta.subtitle?.trim();
  if (subtitle) result.subtitle = subtitle;

  const authors = personNames(meta.author);
  if (authors.length) result.author = authors.length === 1 ? authors[0] : authors;

  const publishers = personNames(meta.publisher);
  if (publishers.length) result.publisher = publishers.join(', ');

  const published = meta.published?.trim();
  if (published) result.published = published;

  const language = Array.isArray(meta.language)
    ? meta.language.map((lang) => lang.trim()).filter(Boolean)
    : meta.language?.trim();
  if (language?.length) result.language = language;

  const identifier = meta.identifier?.trim();
  if (identifier) result.identifier = identifier;

  const subjects = subjectNames(meta.subject);
  if (subjects.length) result.subject = subjects;

  // Same precedence as PublicationView: the typed Atom <content>/<summary>
  // first, then the OPDS 2.0 plain description; sanitized because BookDetailView
  // renders the description as HTML.
  const content = meta[SYMBOL.CONTENT] || meta.content;
  const description = getOPDSDescriptionHtml(content ?? meta.description);
  if (description) result.description = description;

  return result;
};

/**
 * Merge the metadata an OPDS entry advertises into an imported book: per
 * field, the feed wins and the file fills the rest (series, custom columns,
 * an ISBN the feed does not repeat). Denormalized fields (title, author,
 * primaryLanguage) are re-derived only when the feed provided their source,
 * so "Download Again" cannot reset a user-edited title with a feed that says
 * nothing about it. Bumps the metadata sync clock like a manual edit —
 * metadata travels in the book row itself, so unlike coverUpdatedAt there is
 * no upload-first hazard. Never touches sourceTitle (locates the cloud file)
 * or metaHash (dedupe stays file-derived).
 *
 * Mutates in place like applyOPDSCover: both call sites run before the
 * library is saved, and the library page is not mounted during OPDS
 * downloads.
 */
export const applyOPDSMetadata = (book: Book, opdsMetadata: OPDSBookMetadata): void => {
  if (!Object.keys(opdsMetadata).length) return;
  const metadata = { ...book.metadata, ...opdsMetadata } as BookMetadata;
  normalizeMetadataIsbn(metadata);
  book.metadata = metadata;
  if (opdsMetadata.language) {
    book.primaryLanguage = getPrimaryLanguage(metadata.language);
  }
  if (opdsMetadata.title) {
    book.title = formatTitle(metadata.title);
  }
  if (opdsMetadata.author) {
    book.author = formatAuthors(metadata.author, book.primaryLanguage);
  }
  const now = Date.now();
  book.updatedAt = now;
  book.metadataUpdatedAt = now;
};
