import { getPublication } from 'foliate-js/opds.js';
import type { OPDSBaseLink, OPDSPublication } from '@/types/opds';
import { looksLikeXMLContent, MIME, parseMediaType, parseOPDSXML, resolveURL } from './opdsUtils';

// Media type of a standalone OPDS 2.0 publication document.
const OPDS_PUBLICATION_JSON = 'application/opds-publication+json';

/**
 * Find a publication's canonical document link (`rel="self"`) that dereferences
 * to a *full* OPDS publication record. OPDS feeds frequently list publications
 * in summary form (title + cover + acquisition links) and carry the complete
 * metadata — description, publisher, subjects, language — only in the standalone
 * publication document this link points at (readest issue #4749, matching what
 * Thorium shows). Returns its href/type, or undefined when the publication has
 * no such link.
 *
 * Recognized document types: OPDS 2.0 JSON (`application/opds-publication+json`)
 * and an Atom catalog entry (`application/atom+xml;type=entry`).
 */
export const getPublicationDetailHref = (
  publication: OPDSPublication,
): { href: string; type?: string } | undefined => {
  for (const link of publication.links ?? []) {
    const rels = Array.isArray(link.rel) ? link.rel : [link.rel ?? ''];
    if (!link.href || !rels.includes('self')) continue;
    const parsed = parseMediaType(link.type);
    if (!parsed) continue;
    const { mediaType, parameters } = parsed;
    if (mediaType === OPDS_PUBLICATION_JSON) return { href: link.href, type: link.type };
    if (mediaType === MIME.ATOM && parameters['type'] === 'entry') {
      return { href: link.href, type: link.type };
    }
  }
  return undefined;
};

const absolutizeLinks = <T extends OPDSBaseLink>(
  links: T[] | undefined,
  docURL: string,
): T[] | undefined =>
  links?.map((link) => (link.href ? { ...link, href: resolveURL(link.href, docURL) } : link));

/**
 * Parse a fetched OPDS publication document (the body behind a detail link, see
 * getPublicationDetailHref) into an OPDSPublication. Supports OPDS 2.0 JSON and
 * Atom entry XML. Link and image hrefs are resolved to absolute URLs against the
 * document's own URL so the detail view keeps resolving downloads and the cover
 * correctly even though it carries the original feed's base URL. Returns null
 * when the body is not a recognizable single publication.
 */
export const parsePublicationDocument = (text: string, docURL: string): OPDSPublication | null => {
  let publication: OPDSPublication | null = null;
  if (looksLikeXMLContent(text)) {
    const doc = parseOPDSXML(text);
    if (doc.documentElement?.localName !== 'entry') return null;
    publication = getPublication(doc.documentElement) as OPDSPublication;
  } else {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return null;
    }
    if (!json || typeof json !== 'object' || !('metadata' in json)) return null;
    publication = json as OPDSPublication;
  }
  return {
    metadata: publication.metadata,
    links: absolutizeLinks(publication.links, docURL) ?? [],
    images: absolutizeLinks(publication.images, docURL) ?? [],
  };
};
