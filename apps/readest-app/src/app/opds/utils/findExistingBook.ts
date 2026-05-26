import { Book } from '@/types/book';
import { OPDSPublication } from '@/types/opds';
import { BookMetadata } from '@/libs/document';
import { getMetadataHashInfo, MetadataHashInfo } from '@/utils/book';

/**
 * Normalize a string for tolerant title comparison: NFC, collapse internal
 * whitespace, lowercase, trim.
 */
const normalizeText = (s: string | undefined | null): string => {
  if (!s) return '';
  return s.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
};

/**
 * Cast an OPDS publication's metadata to BookMetadata so the library's own
 * hashing/normalization helpers (getMetadataHashInfo et al.) can consume it.
 * BookMetadata and OPDSPublicationMetadata share the same upstream shape
 * (title / author / identifier / ...); the few OPDS-only fields the helpers
 * don't read are harmless.
 */
const asBookMetadata = (pub: OPDSPublication): BookMetadata =>
  (pub.metadata ?? {}) as unknown as BookMetadata;

/**
 * Build the merged identifier list for an OPDS publication. The standard
 * `getMetadataHashInfo` only reads `metadata.identifier` (Dublin Core), but
 * many Atom-based OPDS feeds (Gutenberg, ManyBooks, ...) carry the work
 * identifier exclusively in `<atom:id>` and never expose `<dc:identifier>`.
 * We splice that atom id into the candidate identifier list so downstream
 * matching can recover it.
 */
const collectPublicationIdentifiers = (pub: OPDSPublication): string[] => {
  const out: string[] = [];
  const md = pub.metadata;
  if (md?.identifier) out.push(md.identifier);
  if (md?.id) out.push(md.id);
  return out;
};

/**
 * Compute the same metadata fingerprint the bookService stores on Book, but
 * with the Atom `<id>` merged into the identifiers list (see
 * collectPublicationIdentifiers).  Returns null when the publication has no
 * usable metadata at all.
 */
const fingerprintPublication = (pub: OPDSPublication): MetadataHashInfo | null => {
  const info = getMetadataHashInfo(asBookMetadata(pub));
  if (!info) return null;
  const extraIds = collectPublicationIdentifiers(pub)
    .map((i) => normalizeText(i))
    .filter(Boolean);
  const mergedIds = Array.from(new Set([...info.identifiers, ...extraIds]));
  const merged: MetadataHashInfo = { ...info, identifiers: mergedIds };
  // Empty fingerprints (no title, no author, no identifier) would collide
  // with every malformed book in the library — treat them as "not enough
  // signal" instead.
  if (!merged.title && merged.authors.length === 0 && merged.identifiers.length === 0) return null;
  return merged;
};

const fingerprintBook = (book: Book): MetadataHashInfo | null => {
  if (!book.metadata) return null;
  return getMetadataHashInfo(book.metadata) ?? null;
};

/**
 * Generate comparison keys for an identifier. The library's normalizeIdentifier
 * strips one prefix (urn: → tail, other scheme → after-first-colon) which
 * yields divergent forms for the same logical ID — e.g. an OPDS Gutenberg
 * entry's `urn:gutenberg:1342` becomes "1342" while an EPUB's
 * `http://www.gutenberg.org/ebooks/1342` becomes "//www.gutenberg.org/ebooks/1342".
 * To bridge those, we keep the already-normalized value AND derive a "tail"
 * key: the last numeric/alphanumeric segment if recognizable, otherwise the
 * substring after the final '/' or ':'. The tail key only matches when it's
 * sufficiently distinctive (>= 3 chars) so we don't collide on things like
 * "v1" or "en".
 */
const identifierKeys = (id: string): string[] => {
  const out = new Set<string>();
  if (!id) return [];
  const normalized = id.normalize('NFC').trim().toLowerCase();
  if (!normalized) return [];
  out.add(normalized);

  // Pure-digits tail (Gutenberg IDs, etc.)
  const digitTail = normalized.match(/(\d{3,})(?!.*\d)/)?.[1];
  if (digitTail) out.add(digitTail);

  // Last path/colon segment
  const segments = normalized.split(/[/:]/).filter(Boolean);
  const lastSeg = segments[segments.length - 1];
  if (lastSeg && lastSeg.length >= 3) out.add(lastSeg);

  return Array.from(out);
};

const hasIdentifierOverlap = (a: string[], b: string[]): boolean => {
  if (a.length === 0 || b.length === 0) return false;
  const aKeys = new Set<string>();
  for (const id of a) for (const k of identifierKeys(id)) aKeys.add(k);
  for (const id of b) for (const k of identifierKeys(id)) if (aKeys.has(k)) return true;
  return false;
};

/**
 * Split a normalized author string into name tokens for fuzzy comparison.
 * Returns the kept tokens AND the total number of "raw" tokens the splitter
 * saw — callers use the latter to distinguish a real mononym ("Plato") from
 * a multi-token name whose discriminative parts got filtered out
 * ("Author A" → kept {author}, raw count 2).
 * Filters: single-character tokens (initials, "A"/"B") and pure-digit /
 * year-range tokens ("1775-1817").
 */
const nameTokens = (name: string): { tokens: Set<string>; rawCount: number } => {
  const tokens = new Set<string>();
  if (!name) return { tokens, rawCount: 0 };
  const raws = name.split(/[\s,;]+/).filter(Boolean);
  for (const raw of raws) {
    const t = raw.replace(/[.()]/g, '').trim();
    if (t.length < 2) continue;
    if (/^\d+(-\d+)?$/.test(t)) continue;
    tokens.add(t);
  }
  return { tokens, rawCount: raws.length };
};

const hasAuthorOverlap = (a: string[], b: string[]): boolean => {
  if (a.length === 0 || b.length === 0) return false;
  // Fast path: exact normalized equality.
  const bSet = new Set(b);
  for (const x of a) if (bSet.has(x)) return true;
  // Token-set path: handle "Lastname, Firstname" vs "Firstname Lastname"
  // and variants like "Austen, Jane, 1775-1817" vs "Jane Austen". A single
  // shared token only counts when BOTH sides are genuine mononyms (raw
  // splitter saw 1 token); otherwise require >= 2 shared tokens so we
  // don't falsely match "Author A" with "Author B" (both collapse to
  // {author} after dropping single-letter tokens).
  for (const x of a) {
    const { tokens: xT, rawCount: xRaw } = nameTokens(x);
    if (xT.size === 0) continue;
    for (const y of b) {
      const { tokens: yT, rawCount: yRaw } = nameTokens(y);
      if (yT.size === 0) continue;
      let shared = 0;
      for (const t of xT) if (yT.has(t)) shared++;
      if (shared === 0) continue;
      const bothMononym = xRaw === 1 && yRaw === 1;
      if (bothMononym ? shared >= 1 : shared >= 2) return true;
    }
  }
  return false;
};

/**
 * Find a book in the user's library that corresponds to an OPDS publication.
 *
 * Matching strategy, in priority order:
 *
 *   1. metaHash equality — the same fingerprint bookService uses when
 *      deduplicating imports. Strongest signal; succeeds when the OPDS feed
 *      and the EPUB's internal Dublin Core metadata agree exactly on title +
 *      authors + identifiers (publisher pipelines like Standard Ebooks).
 *   2. Identifier intersection — when the OPDS feed and the EPUB share at
 *      least one normalized identifier (Gutenberg ID, ISBN, URN, ...).
 *      Strong even when titles/authors differ in formatting because identifier
 *      normalization strips schemes and URN prefixes.
 *   3. Title-equals + author-overlap — falls back to comparing the
 *      normalized title and checking at least one author name overlaps.
 *      Catches sources that don't expose identifiers (or expose ones the
 *      EPUB doesn't carry) but agree on the human-readable metadata.
 *
 * Soft-deleted books are skipped so users see "Download" again after
 * explicitly removing a copy from the library. Returns null when nothing
 * matches.
 */
export const findExistingBookForPublication = (
  publication: OPDSPublication | null | undefined,
  library: Book[] | null | undefined,
): Book | null => {
  if (!publication || !library || library.length === 0) return null;

  const pubInfo = fingerprintPublication(publication);
  if (!pubInfo) return null;

  const pubTitleNorm = normalizeText(pubInfo.title);
  const pubAuthorsNorm = pubInfo.authors.map((a) => normalizeText(a)).filter(Boolean);
  const pubIdentifiersNorm = pubInfo.identifiers.map((i) => normalizeText(i)).filter(Boolean);

  let identifierMatch: Book | null = null;
  let titleAuthorMatch: Book | null = null;

  for (const book of library) {
    if (book.deletedAt) continue;

    // Pass 1: exact metaHash. Cheap (already computed when book was imported)
    // and authoritative when it agrees. Keep scanning the rest of the library
    // even after a fuzzy hit so a later metaHash match can still take over.
    if (book.metaHash && book.metaHash === pubInfo.metaHash) {
      return book;
    }

    const bookInfo = fingerprintBook(book);
    if (!bookInfo) continue;

    // Pass 2: any identifier overlap (Gutenberg ID, ISBN, etc.). Uses
    // identifierKeys() so different prefix/URL forms of the same ID still
    // resolve to a shared tail key.
    if (!identifierMatch && pubIdentifiersNorm.length > 0) {
      const bookIdentifiersNorm = bookInfo.identifiers.map((i) => normalizeText(i)).filter(Boolean);
      if (hasIdentifierOverlap(pubIdentifiersNorm, bookIdentifiersNorm)) {
        identifierMatch = book;
      }
    }

    // Pass 3: title + author-overlap fallback for sources without usable
    // identifiers. Title must match (normalized); we accept the book if at
    // least one author name overlaps so OPDS feeds writing "Lastname,
    // Firstname" still match EPUBs that store "Firstname Lastname" only
    // when one of those forms also appears on both sides — i.e. we don't
    // over-match here.
    if (!titleAuthorMatch && pubTitleNorm) {
      const bookTitleNorm = normalizeText(bookInfo.title);
      if (bookTitleNorm === pubTitleNorm) {
        const bookAuthorsNorm = bookInfo.authors.map((a) => normalizeText(a)).filter(Boolean);
        if (pubAuthorsNorm.length === 0 || bookAuthorsNorm.length === 0) {
          // Either side lacks author info — accept on title alone.
          titleAuthorMatch = book;
        } else if (hasAuthorOverlap(pubAuthorsNorm, bookAuthorsNorm)) {
          titleAuthorMatch = book;
        }
      }
    }
  }

  return identifierMatch ?? titleAuthorMatch;
};
