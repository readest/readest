import { isOPDSCatalog } from 'foliate-js/opds.js';
import { replace as expandURITemplate, getVariables } from 'foliate-js/uri-template.js';
import { OPDSBaseLink } from '@/types/opds';
import { EXTS } from '@/libs/document';
import { fetchWithAuth } from './opdsReq';

export const groupByArray = <T, K>(arr: T[] | undefined, f: (el: T) => K | K[]): Map<K, T[]> => {
  const map = new Map<K, T[]>();
  if (arr) {
    for (const el of arr) {
      const keys = f(el);
      for (const key of [keys].flat()) {
        const group = map.get(key as K);
        if (group) group.push(el);
        else map.set(key as K, [el]);
      }
    }
  }
  return map;
};

export const MIME = {
  XML: 'application/xml',
  ATOM: 'application/atom+xml',
  XHTML: 'application/xhtml+xml',
  HTML: 'text/html',
  EPUB: 'application/epub+zip',
  PDF: 'application/pdf',
  OPENSEARCH: 'application/opensearchdescription+xml',
  OPDS2: 'application/opds+json',
};

export const enum VALIDATION_ERROR {
  INVALID_URL = 'Invalid URL format',
  LOAD_FAILED = 'Failed to load OPDS feed',
  NOT_OPDS = 'Invalid OPDS feed URL',
  NO_OPDS_LINK = 'Document has no link to OPDS feeds',
  NO_HREF = 'OPDS link has no href attribute',
  INVALID_HTML = 'Invalid HTML document',
  INVALID_CONTENT = 'Content is neither valid XML nor JSON',
}

interface ValidationResult {
  isValid: boolean;
  error?: VALIDATION_ERROR | string;
  data?: {
    type: 'feed' | 'entry' | 'opensearch' | 'html';
    doc: Document;
    text: string;
    responseURL: string;
  };
}

export const parseMediaType = (str?: string) => {
  if (!str) return null;
  const [mediaType, ...ps] = str.split(/ *; */);
  if (!mediaType) return null;

  return {
    mediaType: mediaType.toLowerCase(),
    parameters: Object.fromEntries(
      ps
        .map((p) => {
          const [name, val] = p.split('=');
          if (!name) return null;
          return [name.toLowerCase(), val?.replace(/(^"|"$)/g, '')];
        })
        .filter((entry): entry is [string, string] => entry !== null),
    ),
  };
};

/**
 * Detect whether an OPDS response body is XML rather than JSON.
 *
 * Some OPDS servers (e.g. the Hungarian MEK catalog, issue #4181) return XML
 * feeds with leading whitespace/newlines before the root element — sometimes
 * without an `<?xml ?>` declaration — and a wrong `text/html` Content-Type. A
 * naive `text.startsWith('<')` check then misfires and the body is handed to
 * JSON.parse, producing "Unexpected token '<' ... is not valid JSON".
 *
 * Trimming leading whitespace (which also strips a UTF-8 BOM) before the
 * check makes detection robust regardless of Content-Type.
 */
export const looksLikeXMLContent = (text: string): boolean => text.trimStart().startsWith('<');

/**
 * Detect a DOMParser error document. Strict XML parsers (Firefox, and jsdom in
 * tests) replace the whole document with a <parsererror> element on any
 * well-formedness violation; Chrome is lenient and often parses on regardless.
 */
const hasXMLParseError = (doc: Document): boolean =>
  doc.documentElement?.localName === 'parsererror' ||
  doc.getElementsByTagName('parsererror').length > 0;

/**
 * Parse an OPDS/Atom XML string, tolerating "junk after the document element".
 *
 * Old OPDS servers (e.g. the Hungarian MEK catalog, issue #4479) emit a valid
 * feed followed by trailing junk — a stray PHP warning, an extra tag, or text
 * after </feed>. Chrome's XML parser ignores it, but Firefox's strict parser
 * fails with "junk after document element" / "text data outside of root node"
 * and replaces the whole document with a <parsererror>. Callers then see a
 * non-feed root, treat the response as HTML, find no OPDS link, and silently
 * navigate back.
 *
 * Recovery: on a parser error, re-parse the slice from the root element's start
 * tag to its last matching end tag (dropping any leading prolog and trailing
 * junk). If recovery still fails, the original error document is returned so
 * callers fall through to their existing HTML/non-OPDS handling.
 */
export const parseOPDSXML = (text: string): Document => {
  const doc = new DOMParser().parseFromString(text, MIME.XML as DOMParserSupportedType);
  if (!hasXMLParseError(doc)) return doc;

  const rootMatch = text.match(/<([A-Za-z_][\w.:-]*)/);
  const rootName = rootMatch?.[1];
  if (rootMatch && rootName !== undefined) {
    const startIdx = rootMatch.index ?? 0;
    const closeTag = `</${rootName}>`;
    const closeIdx = text.lastIndexOf(closeTag);
    if (closeIdx > startIdx) {
      const sliced = text.slice(startIdx, closeIdx + closeTag.length);
      const retry = new DOMParser().parseFromString(sliced, MIME.XML as DOMParserSupportedType);
      if (!hasXMLParseError(retry)) return retry;
    }
  }
  return doc;
};

/**
 * Return the first OPDS-navigable href from a links array (e.g. on an OPDS 2.0
 * JSON author or subject). Only links whose `type` is an OPDS catalog type
 * (per foliate-js `isOPDSCatalog`, e.g. `application/opds+json`) qualify, so a
 * non-OPDS link such as an author's external homepage is ignored. Returns
 * undefined when no such link exists.
 */
export const getOPDSNavLink = (
  links?: Array<{ href?: string; type?: string }>,
): string | undefined => links?.find((link) => link.href && isOPDSCatalog(link.type ?? ''))?.href;

export const isSearchLink = (link: OPDSBaseLink): boolean => {
  const rels = Array.isArray(link.rel) ? link.rel : [link.rel || ''];
  if (!rels.includes('search')) return false;
  return (
    link.type === MIME.OPENSEARCH ||
    link.type === MIME.ATOM ||
    // OPDS 2.0 JSON feeds expose search as a templated link whose href is an
    // RFC 6570 URI template (e.g. `/search{?query}`).
    (link.type === MIME.OPDS2 && !!link.templated)
  );
};

// Template variable names that conventionally carry a free-text search query.
const SEARCH_TERM_VARS = ['query', 'searchTerms', 'q'];

/**
 * Expand an OPDS 2.0 search link's RFC 6570 URI template with a single free-text
 * query term. The term is placed into the template's primary text variable
 * (`query`, `searchTerms`, or `q`; otherwise the first variable). Returns the
 * href unchanged when it has no template variables.
 */
export const expandOPDSSearchTemplate = (templateHref: string, queryTerm: string): string => {
  const variables = Array.from(getVariables(templateHref) as Set<string>);
  const textVar = variables.find((name) => SEARCH_TERM_VARS.includes(name)) ?? variables[0];
  if (!textVar) return templateHref;
  return expandURITemplate(templateHref, new Map([[textVar, queryTerm]]));
};

export const resolveURL = (url: string, relativeTo: string): string => {
  if (!url) return '';
  if (relativeTo.includes('/api/opds/proxy?url=')) {
    const params = new URLSearchParams(relativeTo.split('?')[1]);
    const proxiedURL = params.get('url') || '';
    return resolveURL(url, proxiedURL);
  }
  try {
    if (relativeTo.includes(':')) return new URL(url, relativeTo).toString();
    const root = 'https://invalid.invalid/';
    const obj = new URL(url, root + relativeTo);
    obj.search = '';
    return decodeURI(obj.href.replace(root, ''));
  } catch (e) {
    console.warn(e);
    return url;
  }
};

export const validateOPDSURL = async (
  url: string,
  username?: string,
  password?: string,
  useProxy = false,
  customHeaders: Record<string, string> = {},
): Promise<ValidationResult> => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetchWithAuth(
      url,
      username,
      password,
      useProxy,
      {
        signal: controller.signal,
      },
      customHeaders,
    );
    clearTimeout(timeout);

    if (!res.ok) {
      if (res.status === 401) {
        return {
          isValid: false,
          error: 'Authentication required. Please check your username and password.',
        };
      }
      return {
        isValid: false,
        error: `Failed to load OPDS feed: ${res.status} ${res.statusText}`,
      };
    }

    const responseURL = res.url;
    const text = await res.text();

    // Check if it's XML-based OPDS
    if (looksLikeXMLContent(text)) {
      const doc = parseOPDSXML(text);
      const {
        documentElement: { localName },
      } = doc;

      if (localName === 'feed') {
        return {
          isValid: true,
          data: { type: 'feed', doc, text, responseURL },
        };
      } else if (localName === 'entry') {
        return {
          isValid: true,
          data: { type: 'entry', doc, text, responseURL },
        };
      } else if (localName === 'OpenSearchDescription') {
        return {
          isValid: true,
          data: { type: 'opensearch', doc, text, responseURL },
        };
      } else {
        // Check for HTML with OPDS link
        const contentType = res.headers.get('Content-Type') ?? MIME.HTML;
        const type = parseMediaType(contentType)?.mediaType ?? MIME.HTML;
        const htmlDoc = new DOMParser().parseFromString(text, type as DOMParserSupportedType);

        if (!htmlDoc.head) {
          return {
            isValid: false,
            error: VALIDATION_ERROR.NOT_OPDS,
          };
        }

        const link = Array.from(htmlDoc.head.querySelectorAll('link')).find((link) =>
          isOPDSCatalog(link.getAttribute('type') ?? ''),
        );

        if (!link) {
          return {
            isValid: false,
            error: VALIDATION_ERROR.NOT_OPDS,
          };
        }

        const href = link.getAttribute('href');
        if (!href) {
          return {
            isValid: false,
            error: 'OPDS link has no href attribute',
          };
        }

        return {
          isValid: true,
          data: { type: 'html', doc: htmlDoc, text, responseURL },
        };
      }
    } else {
      // Check if it's JSON-based OPDS
      try {
        const feed = JSON.parse(text);
        // Basic validation for OPDS JSON feed
        if (!feed.metadata && !feed.links && !feed.publications && !feed.navigation) {
          return {
            isValid: false,
            error: VALIDATION_ERROR.NOT_OPDS,
          };
        }
        return {
          isValid: true,
          data: {
            type: 'feed',
            doc: new Document(),
            text,
            responseURL,
          },
        };
      } catch {
        return {
          isValid: false,
          error: VALIDATION_ERROR.NOT_OPDS,
        };
      }
    }
  } catch (e) {
    console.error('OPDS validation error:', e);
    return {
      isValid: false,
      error: e instanceof Error ? e.message : VALIDATION_ERROR.NOT_OPDS,
    };
  }
};

export const getFileExtFromPath = (pathname: string, delimiter = '/'): string => {
  const parts = pathname.split(delimiter);
  for (const ext of Object.values(EXTS)) {
    if (parts.includes(ext)) {
      return ext;
    }
  }
  return '';
};
