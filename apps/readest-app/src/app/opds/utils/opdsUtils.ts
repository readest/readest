import { isOPDSCatalog } from 'foliate-js/opds.js';
import { OPDSLink } from '@/types/opds';
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

export const isSearchLink = (link: OPDSLink): boolean => {
  const rels = Array.isArray(link.rel) ? link.rel : [link.rel || ''];
  return rels.includes('search') && (link.type === MIME.OPENSEARCH || link.type === MIME.ATOM);
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
): Promise<ValidationResult> => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetchWithAuth(url, username, password, useProxy, {
      signal: controller.signal,
    });
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
    if (text.startsWith('<')) {
      const doc = new DOMParser().parseFromString(text, MIME.XML as DOMParserSupportedType);
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
