import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before importing the module under test
vi.mock('foliate-js/opds.js', () => ({
  isOPDSCatalog: vi.fn((type: string) => {
    return (
      type.includes('application/atom+xml') &&
      (type.includes('opds-catalog') || type.includes('opds'))
    );
  }),
}));

vi.mock('@/libs/document', () => ({
  EXTS: {
    EPUB: 'epub',
    PDF: 'pdf',
    MOBI: 'mobi',
    AZW: 'azw',
    AZW3: 'azw3',
    CBZ: 'cbz',
    FB2: 'fb2',
    FBZ: 'fbz',
    TXT: 'txt',
    MD: 'md',
  },
}));

vi.mock('@/services/environment', () => ({
  isWebAppPlatform: vi.fn(() => true),
  isTauriAppPlatform: vi.fn(() => false),
  getAPIBaseUrl: () => '/api',
  getNodeAPIBaseUrl: () => '/node-api',
  getBaseUrl: () => 'https://web.readest.com',
  getNodeBaseUrl: () => 'https://node.readest.com',
  isWebDevMode: () => true,
}));

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}));

vi.mock('@/app/opds/utils/opdsReq', () => ({
  fetchWithAuth: vi.fn(),
}));

import {
  groupByArray,
  parseMediaType,
  isSearchLink,
  resolveURL,
  getFileExtFromPath,
  MIME,
  validateOPDSURL,
} from '@/app/opds/utils/opdsUtils';
import type { OPDSBaseLink } from '@/types/opds';
import { fetchWithAuth } from '@/app/opds/utils/opdsReq';

const mockFetchWithAuth = vi.mocked(fetchWithAuth);

describe('opdsUtils', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('groupByArray', () => {
    it('should group items by a single key', () => {
      const items = [
        { name: 'Alice', role: 'admin' },
        { name: 'Bob', role: 'user' },
        { name: 'Charlie', role: 'admin' },
      ];
      const grouped = groupByArray(items, (item) => item.role);

      expect(grouped.get('admin')).toHaveLength(2);
      expect(grouped.get('user')).toHaveLength(1);
      expect(grouped.get('admin')![0]!.name).toBe('Alice');
      expect(grouped.get('admin')![1]!.name).toBe('Charlie');
    });

    it('should group items by multiple keys (array return)', () => {
      const items = [
        { name: 'Alice', tags: ['a', 'b'] },
        { name: 'Bob', tags: ['b', 'c'] },
      ];
      const grouped = groupByArray(items, (item) => item.tags);

      expect(grouped.get('a')).toHaveLength(1);
      expect(grouped.get('b')).toHaveLength(2);
      expect(grouped.get('c')).toHaveLength(1);
    });

    it('should return an empty map for undefined input', () => {
      const grouped = groupByArray(undefined, (item: string) => item);
      expect(grouped.size).toBe(0);
    });

    it('should return an empty map for empty array', () => {
      const grouped = groupByArray([], (item: string) => item);
      expect(grouped.size).toBe(0);
    });

    it('should handle single-element arrays', () => {
      const items = [{ id: 1 }];
      const grouped = groupByArray(items, (item) => item.id);
      expect(grouped.get(1)).toHaveLength(1);
    });
  });

  describe('MIME constants', () => {
    it('should have correct XML MIME type', () => {
      expect(MIME.XML).toBe('application/xml');
    });

    it('should have correct ATOM MIME type', () => {
      expect(MIME.ATOM).toBe('application/atom+xml');
    });

    it('should have correct XHTML MIME type', () => {
      expect(MIME.XHTML).toBe('application/xhtml+xml');
    });

    it('should have correct HTML MIME type', () => {
      expect(MIME.HTML).toBe('text/html');
    });

    it('should have correct EPUB MIME type', () => {
      expect(MIME.EPUB).toBe('application/epub+zip');
    });

    it('should have correct PDF MIME type', () => {
      expect(MIME.PDF).toBe('application/pdf');
    });

    it('should have correct OPENSEARCH MIME type', () => {
      expect(MIME.OPENSEARCH).toBe('application/opensearchdescription+xml');
    });
  });

  describe('parseMediaType', () => {
    it('should parse a simple media type', () => {
      const result = parseMediaType('application/atom+xml');
      expect(result).not.toBeNull();
      expect(result!.mediaType).toBe('application/atom+xml');
      expect(Object.keys(result!.parameters)).toHaveLength(0);
    });

    it('should parse media type with parameters', () => {
      const result = parseMediaType('application/atom+xml; charset=utf-8');
      expect(result).not.toBeNull();
      expect(result!.mediaType).toBe('application/atom+xml');
      expect(result!.parameters['charset']).toBe('utf-8');
    });

    it('should parse media type with multiple parameters', () => {
      const result = parseMediaType('text/html; charset=utf-8; boundary=something');
      expect(result).not.toBeNull();
      expect(result!.mediaType).toBe('text/html');
      expect(result!.parameters['charset']).toBe('utf-8');
      expect(result!.parameters['boundary']).toBe('something');
    });

    it('should parse media type with quoted parameter values', () => {
      const result = parseMediaType('application/atom+xml; profile="opds-catalog"');
      expect(result).not.toBeNull();
      expect(result!.parameters['profile']).toBe('opds-catalog');
    });

    it('should lowercase the media type', () => {
      const result = parseMediaType('Application/Atom+XML');
      expect(result).not.toBeNull();
      expect(result!.mediaType).toBe('application/atom+xml');
    });

    it('should lowercase parameter names', () => {
      const result = parseMediaType('text/html; Charset=utf-8');
      expect(result).not.toBeNull();
      expect(result!.parameters['charset']).toBe('utf-8');
    });

    it('should return null for empty string', () => {
      expect(parseMediaType('')).toBeNull();
    });

    it('should return null for undefined input', () => {
      expect(parseMediaType(undefined)).toBeNull();
    });

    it('should handle extra spaces around semicolons', () => {
      const result = parseMediaType('text/html ;  charset=utf-8');
      expect(result).not.toBeNull();
      expect(result!.mediaType).toBe('text/html');
      expect(result!.parameters['charset']).toBe('utf-8');
    });
  });

  describe('isSearchLink', () => {
    it('should return true for a search link with OPENSEARCH type', () => {
      const link: OPDSBaseLink = {
        rel: ['search'],
        href: '/search',
        type: MIME.OPENSEARCH,
      };
      expect(isSearchLink(link)).toBe(true);
    });

    it('should return true for a search link with ATOM type', () => {
      const link: OPDSBaseLink = {
        rel: ['search'],
        href: '/search',
        type: MIME.ATOM,
      };
      expect(isSearchLink(link)).toBe(true);
    });

    it('should return true when rel is an array containing "search"', () => {
      const link: OPDSBaseLink = {
        rel: ['self', 'search'],
        href: '/search',
        type: MIME.OPENSEARCH,
      };
      expect(isSearchLink(link)).toBe(true);
    });

    it('should return false when rel does not include "search"', () => {
      const link: OPDSBaseLink = {
        rel: ['self'],
        href: '/search',
        type: MIME.OPENSEARCH,
      };
      expect(isSearchLink(link)).toBe(false);
    });

    it('should return false when type is not OPENSEARCH or ATOM', () => {
      const link: OPDSBaseLink = {
        rel: ['search'],
        href: '/search',
        type: 'text/html',
      };
      expect(isSearchLink(link)).toBe(false);
    });

    it('should return false when rel is undefined', () => {
      const link: OPDSBaseLink = {
        href: '/search',
        type: MIME.OPENSEARCH,
      };
      expect(isSearchLink(link)).toBe(false);
    });

    it('should return false when rel is an empty array', () => {
      const link: OPDSBaseLink = {
        rel: [],
        href: '/search',
        type: MIME.ATOM,
      };
      expect(isSearchLink(link)).toBe(false);
    });
  });

  describe('resolveURL', () => {
    it('should resolve an absolute URL relative to a base URL', () => {
      const result = resolveURL('/feed/new', 'https://example.com/opds');
      expect(result).toBe('https://example.com/feed/new');
    });

    it('should resolve a relative URL relative to a base URL', () => {
      const result = resolveURL('new', 'https://example.com/opds/feed');
      expect(result).toBe('https://example.com/opds/new');
    });

    it('should return empty string for empty url', () => {
      expect(resolveURL('', 'https://example.com')).toBe('');
    });

    it('should resolve through proxy URL', () => {
      const proxyBase = '/api/opds/proxy?url=https%3A%2F%2Fexample.com%2Fopds';
      const result = resolveURL('/feed/new', proxyBase);
      expect(result).toBe('https://example.com/feed/new');
    });

    it('should handle non-scheme relativeTo (path-only)', () => {
      const result = resolveURL('subdir/file.xml', '/opds/catalog/');
      // Should use the invalid.invalid root and strip it
      expect(result).toContain('subdir/file.xml');
      expect(result).not.toContain('invalid.invalid');
    });

    it('should return the URL itself when resolution fails', () => {
      // Suppress console.warn for this test
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = resolveURL('://broken', '://also-broken');
      // Should fall through to the catch and return url
      expect(result).toBe('://broken');
      warnSpy.mockRestore();
    });

    it('should handle full absolute URLs as the url parameter', () => {
      const result = resolveURL('https://other.com/feed', 'https://example.com/opds');
      expect(result).toBe('https://other.com/feed');
    });

    it('should strip query parameters for non-scheme relativeTo', () => {
      const result = resolveURL('feed.xml?page=2', '/opds/catalog/');
      // The function strips search params for non-scheme relativeTo
      expect(result).not.toContain('page=2');
    });
  });

  describe('getFileExtFromPath', () => {
    it('should find epub extension in path', () => {
      expect(getFileExtFromPath('/books/epub/my-book')).toBe('epub');
    });

    it('should find pdf extension in path', () => {
      expect(getFileExtFromPath('/books/pdf/my-doc')).toBe('pdf');
    });

    it('should find mobi extension in path', () => {
      expect(getFileExtFromPath('/books/mobi/my-book')).toBe('mobi');
    });

    it('should find cbz extension in path', () => {
      expect(getFileExtFromPath('/comics/cbz/issue1')).toBe('cbz');
    });

    it('should find fb2 extension in path', () => {
      expect(getFileExtFromPath('/books/fb2/russian-novel')).toBe('fb2');
    });

    it('should find txt extension in path', () => {
      expect(getFileExtFromPath('/texts/txt/readme')).toBe('txt');
    });

    it('should find md extension in path', () => {
      expect(getFileExtFromPath('/notes/md/guide')).toBe('md');
    });

    it('should return empty string when no extension found', () => {
      expect(getFileExtFromPath('/books/unknown/my-book')).toBe('');
    });

    it('should return empty string for empty path', () => {
      expect(getFileExtFromPath('')).toBe('');
    });

    it('should use custom delimiter', () => {
      expect(getFileExtFromPath('books.epub.my-book', '.')).toBe('epub');
    });

    it('should return the first matching extension', () => {
      // If both epub and pdf appear, returns whichever EXTS entry matches first
      const result = getFileExtFromPath('/books/epub/pdf/file');
      expect(['epub', 'pdf']).toContain(result);
    });
  });

  describe('validateOPDSURL', () => {
    beforeEach(() => {
      mockFetchWithAuth.mockReset();
      // Suppress expected error noise from validation failure tests.
      vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    it('should return valid feed for XML OPDS feed', async () => {
      const xmlFeed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Test Feed</title>
</feed>`;

      mockFetchWithAuth.mockResolvedValue({
        ok: true,
        url: 'https://example.com/opds',
        text: () => Promise.resolve(xmlFeed),
        headers: new Headers({ 'Content-Type': 'application/atom+xml' }),
      } as Response);

      const result = await validateOPDSURL('https://example.com/opds');
      expect(result.isValid).toBe(true);
      expect(result.data?.type).toBe('feed');
      expect(result.data?.responseURL).toBe('https://example.com/opds');
    });

    it('should return valid entry for XML entry document', async () => {
      const xmlEntry = `<?xml version="1.0" encoding="UTF-8"?>
<entry xmlns="http://www.w3.org/2005/Atom">
  <title>Single Book</title>
</entry>`;

      mockFetchWithAuth.mockResolvedValue({
        ok: true,
        url: 'https://example.com/opds/entry',
        text: () => Promise.resolve(xmlEntry),
        headers: new Headers(),
      } as Response);

      const result = await validateOPDSURL('https://example.com/opds/entry');
      expect(result.isValid).toBe(true);
      expect(result.data?.type).toBe('entry');
    });

    it('should return valid opensearch for OpenSearchDescription', async () => {
      const xmlOSD = `<?xml version="1.0" encoding="UTF-8"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
  <ShortName>Search</ShortName>
</OpenSearchDescription>`;

      mockFetchWithAuth.mockResolvedValue({
        ok: true,
        url: 'https://example.com/search',
        text: () => Promise.resolve(xmlOSD),
        headers: new Headers(),
      } as Response);

      const result = await validateOPDSURL('https://example.com/search');
      expect(result.isValid).toBe(true);
      expect(result.data?.type).toBe('opensearch');
    });

    it('should return authentication error for 401 status', async () => {
      mockFetchWithAuth.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        url: 'https://example.com/opds',
        text: () => Promise.resolve(''),
        headers: new Headers(),
      } as Response);

      const result = await validateOPDSURL('https://example.com/opds');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Authentication required');
    });

    it('should return error for non-OK HTTP response', async () => {
      mockFetchWithAuth.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        url: 'https://example.com/opds',
        text: () => Promise.resolve(''),
        headers: new Headers(),
      } as Response);

      const result = await validateOPDSURL('https://example.com/opds');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('500');
    });

    it('should return valid feed for JSON-based OPDS', async () => {
      const jsonFeed = JSON.stringify({
        metadata: { title: 'Test Feed' },
        links: [],
        publications: [],
      });

      mockFetchWithAuth.mockResolvedValue({
        ok: true,
        url: 'https://example.com/opds.json',
        text: () => Promise.resolve(jsonFeed),
        headers: new Headers(),
      } as Response);

      const result = await validateOPDSURL('https://example.com/opds.json');
      expect(result.isValid).toBe(true);
      expect(result.data?.type).toBe('feed');
    });

    it('should return invalid for JSON without OPDS fields', async () => {
      const jsonData = JSON.stringify({ foo: 'bar' });

      mockFetchWithAuth.mockResolvedValue({
        ok: true,
        url: 'https://example.com/data.json',
        text: () => Promise.resolve(jsonData),
        headers: new Headers(),
      } as Response);

      const result = await validateOPDSURL('https://example.com/data.json');
      expect(result.isValid).toBe(false);
    });

    it('should return invalid for non-XML, non-JSON content', async () => {
      mockFetchWithAuth.mockResolvedValue({
        ok: true,
        url: 'https://example.com/page',
        text: () => Promise.resolve('Just some plain text'),
        headers: new Headers(),
      } as Response);

      const result = await validateOPDSURL('https://example.com/page');
      expect(result.isValid).toBe(false);
    });

    it('should handle fetch errors gracefully', async () => {
      mockFetchWithAuth.mockRejectedValue(new Error('Network error'));

      const result = await validateOPDSURL('https://example.com/opds');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Network error');
    });

    it('should handle non-Error exceptions', async () => {
      mockFetchWithAuth.mockRejectedValue('string error');

      const result = await validateOPDSURL('https://example.com/opds');
      expect(result.isValid).toBe(false);
    });

    it('should return valid for JSON feed with only navigation', async () => {
      const jsonFeed = JSON.stringify({
        navigation: [{ title: 'New', href: '/new' }],
      });

      mockFetchWithAuth.mockResolvedValue({
        ok: true,
        url: 'https://example.com/opds.json',
        text: () => Promise.resolve(jsonFeed),
        headers: new Headers(),
      } as Response);

      const result = await validateOPDSURL('https://example.com/opds.json');
      expect(result.isValid).toBe(true);
    });

    it('should return invalid for XML that is not a recognized OPDS document type', async () => {
      const xmlDoc = `<?xml version="1.0" encoding="UTF-8"?>
<catalog>
  <book>Test</book>
</catalog>`;

      mockFetchWithAuth.mockResolvedValue({
        ok: true,
        url: 'https://example.com/catalog',
        text: () => Promise.resolve(xmlDoc),
        headers: new Headers({ 'Content-Type': 'application/xml' }),
      } as Response);

      const result = await validateOPDSURL('https://example.com/catalog');
      expect(result.isValid).toBe(false);
    });

    it('should pass auth and custom headers to fetchWithAuth', async () => {
      const xmlFeed = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Auth Feed</title></feed>`;
      const customHeaders = {
        'CF-Access-Client-Id': 'client-id',
        'CF-Access-Client-Secret': 'client-secret',
      };

      mockFetchWithAuth.mockResolvedValue({
        ok: true,
        url: 'https://example.com/opds',
        text: () => Promise.resolve(xmlFeed),
        headers: new Headers(),
      } as Response);

      await validateOPDSURL('https://example.com/opds', 'user', 'pass', true, customHeaders);

      expect(mockFetchWithAuth).toHaveBeenCalledWith(
        'https://example.com/opds',
        'user',
        'pass',
        true,
        expect.objectContaining({ signal: expect.anything() }),
        customHeaders,
      );
    });
  });
});
