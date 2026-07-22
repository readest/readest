import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OPDSCatalog, OPDSFeed } from '@/types/opds';
import type { OPDSSubscriptionState } from '@/services/opds/types';
import { MAX_CRAWL_DEPTH, MAX_FEEDS_PER_CRAWL } from '@/services/opds/types';
import { checkFeedForNewItems, getSubsectionURLs } from '@/services/opds/feedChecker';
import { fetchWithAuth } from '@/app/opds/utils/opdsReq';

vi.mock('@/services/environment', () => ({
  isWebAppPlatform: vi.fn(() => false),
  isTauriAppPlatform: vi.fn(() => true),
  getAPIBaseUrl: () => '/api',
  getNodeAPIBaseUrl: () => '/node-api',
}));

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}));

vi.mock('@/app/opds/utils/opdsReq', () => ({
  fetchWithAuth: vi.fn(),
  needsProxy: vi.fn(() => false),
  getProxiedURL: vi.fn((url: string) => url),
}));

// --- Copyparty-style feed fixtures -----------------------------------------
// Reproduces https://github.com/readest/readest/issues/4272: copyparty
// exposes each directory as an OPDS feed where subdirectories are
// rel="subsection" navigation entries and files are acquisition entries.
// There is no "by newest" feed and no pagination.

const dirEntry = (name: string, href: string) => `
  <entry>
    <id>urn:uuid:dir-${name}</id>
    <title>${name}/</title>
    <link rel="subsection"
      href="${href}"
      type="application/atom+xml;profile=opds-catalog"/>
    <updated>2026-03-28T05:37:03Z</updated>
  </entry>`;

const bookEntry = (id: string, title: string, href: string) => `
  <entry>
    <id>${id}</id>
    <title>${title}</title>
    <updated>2025-11-02T17:50:21Z</updated>
    <link rel="http://opds-spec.org/acquisition"
      href="${href}"
      type="application/epub+zip"/>
  </entry>`;

const feedXML = (
  title: string,
  body: string,
  extraLinks = '',
) => `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>urn:uuid:feed-${title}</id>
  <title>${title}</title>
  ${extraLinks}
  ${body}
</feed>`;

const BASE = 'https://files.example.com/books/Kids/?opds';
const RAMONA_URL = 'https://files.example.com/books/Kids/Ramona/?opds';

// URL → XML served by the mocked fetchWithAuth; set per test.
let feeds: Record<string, string>;

const makeCatalog = (): OPDSCatalog => ({ id: 'cat-1', name: 'Kids', url: BASE });

const emptyState = (): OPDSSubscriptionState => ({
  catalogId: 'cat-1',
  lastCheckedAt: 0,
  knownEntryIds: [],
  failedEntries: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  feeds = {};
  vi.mocked(fetchWithAuth).mockImplementation(async (url: string) => {
    const xml = feeds[url];
    if (!xml) {
      return {
        ok: false,
        url,
        status: 404,
        statusText: 'Not Found',
        text: async () => '',
      } as unknown as Response;
    }
    return {
      ok: true,
      url,
      status: 200,
      statusText: 'OK',
      text: async () => xml,
    } as unknown as Response;
  });
});

describe('checkFeedForNewItems directory crawl (#4272)', () => {
  it('collects books from subdirectories of a directory-style catalog', async () => {
    feeds[BASE] = feedXML(
      'Kids',
      dirEntry('Ramona', '/books/Kids/Ramona/?opds') +
        bookEntry('urn:uuid:rosie', 'Rosie Revere.epub', '/books/Kids/Rosie%20Revere.epub?dl'),
    );
    feeds[RAMONA_URL] = feedXML(
      'Ramona',
      bookEntry(
        'urn:uuid:ramona-1',
        'Complete Ramona Collection.epub',
        '/books/Kids/Ramona/Complete%20Ramona%20Collection.epub?dl',
      ),
    );

    const items = await checkFeedForNewItems(makeCatalog(), emptyState());

    const ids = items.map((i) => i.entryId);
    expect(ids).toContain('urn:uuid:rosie');
    expect(ids).toContain('urn:uuid:ramona-1');
    // The subdirectory book must resolve its href against the sub-feed URL.
    const ramonaItem = items.find((i) => i.entryId === 'urn:uuid:ramona-1')!;
    expect(ramonaItem.baseURL).toBe(RAMONA_URL);
  });

  it('crawls a folder that contains only subfolders (no top-level books)', async () => {
    feeds[BASE] = feedXML(
      'Kids',
      dirEntry('Ramona', '/books/Kids/Ramona/?opds') + dirEntry('Beaty', '/books/Kids/Beaty/?opds'),
    );
    feeds[RAMONA_URL] = feedXML(
      'Ramona',
      bookEntry('urn:uuid:ramona-1', 'Ramona.epub', '/books/Kids/Ramona/Ramona.epub?dl'),
    );
    feeds['https://files.example.com/books/Kids/Beaty/?opds'] = feedXML(
      'Beaty',
      bookEntry('urn:uuid:beaty-1', 'Beaty.epub', '/books/Kids/Beaty/Beaty.epub?dl'),
    );

    const items = await checkFeedForNewItems(makeCatalog(), emptyState());
    expect(items.map((i) => i.entryId).sort()).toEqual(['urn:uuid:beaty-1', 'urn:uuid:ramona-1']);
  });

  it('collects nested subdirectories (depth 2)', async () => {
    const SUB2 = 'https://files.example.com/books/Kids/Ramona/Extras/?opds';
    feeds[BASE] = feedXML('Kids', dirEntry('Ramona', '/books/Kids/Ramona/?opds'));
    feeds[RAMONA_URL] = feedXML(
      'Ramona',
      dirEntry('Extras', '/books/Kids/Ramona/Extras/?opds') +
        bookEntry('urn:uuid:ramona-1', 'Ramona.epub', '/books/Kids/Ramona/Ramona.epub?dl'),
    );
    feeds[SUB2] = feedXML(
      'Extras',
      bookEntry('urn:uuid:extra-1', 'Extra.epub', '/books/Kids/Ramona/Extras/Extra.epub?dl'),
    );

    const items = await checkFeedForNewItems(makeCatalog(), emptyState());
    expect(items.map((i) => i.entryId).sort()).toEqual(['urn:uuid:extra-1', 'urn:uuid:ramona-1']);
  });

  it('does not crawl navigation when the catalog has a "by newest" feed', async () => {
    const NEWEST_URL = 'https://library.example.com/opds/new';
    const BY_AUTHOR_URL = 'https://library.example.com/opds/author';
    const ROOT = 'https://library.example.com/opds';

    feeds[ROOT] = feedXML(
      'Library',
      dirEntry('author', '/opds/author'),
      '<link rel="http://opds-spec.org/sort/new" href="/opds/new" type="application/atom+xml;profile=opds-catalog"/>',
    );
    feeds[NEWEST_URL] = feedXML(
      'Newest',
      bookEntry('urn:uuid:new-1', 'New Book.epub', '/dl/new-1.epub'),
    );
    feeds[BY_AUTHOR_URL] = feedXML(
      'By Author',
      bookEntry('urn:uuid:author-1', 'Author Book.epub', '/dl/author-1.epub'),
    );

    const catalog: OPDSCatalog = { id: 'cat-1', name: 'Library', url: ROOT };
    const items = await checkFeedForNewItems(catalog, emptyState());

    expect(items.map((i) => i.entryId)).toEqual(['urn:uuid:new-1']);
    const fetchedURLs = vi.mocked(fetchWithAuth).mock.calls.map((c) => c[0]);
    expect(fetchedURLs).not.toContain(BY_AUTHOR_URL);
  });

  it('falls back to root publications without crawling when the newest feed is broken', async () => {
    const ROOT = 'https://library.example.com/opds';
    const BY_AUTHOR_URL = 'https://library.example.com/opds/author';

    // sort/new link points at a 404; root itself has publications + navigation.
    feeds[ROOT] = feedXML(
      'Library',
      dirEntry('author', '/opds/author') +
        bookEntry('urn:uuid:root-1', 'Root Book.epub', '/dl/root-1.epub'),
      '<link rel="http://opds-spec.org/sort/new" href="/opds/new" type="application/atom+xml;profile=opds-catalog"/>',
    );
    feeds[BY_AUTHOR_URL] = feedXML(
      'By Author',
      bookEntry('urn:uuid:author-1', 'Author Book.epub', '/dl/author-1.epub'),
    );

    const catalog: OPDSCatalog = { id: 'cat-1', name: 'Library', url: ROOT };
    const items = await checkFeedForNewItems(catalog, emptyState());

    expect(items.map((i) => i.entryId)).toEqual(['urn:uuid:root-1']);
    const fetchedURLs = vi.mocked(fetchWithAuth).mock.calls.map((c) => c[0]);
    expect(fetchedURLs).not.toContain(BY_AUTHOR_URL);
  });

  it('stops descending at MAX_CRAWL_DEPTH', async () => {
    // Chain: root -> d1 -> d2 -> ... each level has one book and one subdir.
    const dirURL = (i: number) => `https://files.example.com/books/Kids/${'d/'.repeat(i)}?opds`;
    const chainLen = MAX_CRAWL_DEPTH + 2;
    feeds[BASE] = feedXML('Kids', dirEntry('d1', dirURL(1)));
    for (let i = 1; i <= chainLen; i++) {
      feeds[dirURL(i)] = feedXML(
        `d${i}`,
        bookEntry(`urn:uuid:book-${i}`, `Book ${i}.epub`, `/dl/book-${i}.epub`) +
          dirEntry(`d${i + 1}`, dirURL(i + 1)),
      );
    }

    const items = await checkFeedForNewItems(makeCatalog(), emptyState());
    const ids = items.map((i) => i.entryId);
    expect(ids).toContain(`urn:uuid:book-${MAX_CRAWL_DEPTH}`);
    expect(ids).not.toContain(`urn:uuid:book-${MAX_CRAWL_DEPTH + 1}`);
  });

  it('stops fetching after MAX_FEEDS_PER_CRAWL feeds', async () => {
    const subCount = MAX_FEEDS_PER_CRAWL + 10;
    let rootBody = '';
    for (let i = 0; i < subCount; i++) {
      const url = `https://files.example.com/books/Kids/sub${i}/?opds`;
      rootBody += dirEntry(`sub${i}`, url);
      feeds[url] = feedXML(
        `sub${i}`,
        bookEntry(`urn:uuid:sub-${i}`, `Sub ${i}.epub`, `/dl/sub-${i}.epub`),
      );
    }
    feeds[BASE] = feedXML('Kids', rootBody);

    const items = await checkFeedForNewItems(makeCatalog(), emptyState());
    expect(vi.mocked(fetchWithAuth).mock.calls.length).toBeLessThanOrEqual(MAX_FEEDS_PER_CRAWL);
    // Root fetch consumes one slot from the budget.
    expect(items).toHaveLength(MAX_FEEDS_PER_CRAWL - 1);
  });

  it('does not loop on subdirectories that link back to the root', async () => {
    feeds[BASE] = feedXML(
      'Kids',
      dirEntry('Ramona', '/books/Kids/Ramona/?opds') +
        bookEntry('urn:uuid:rosie', 'Rosie.epub', '/dl/rosie.epub'),
    );
    feeds[RAMONA_URL] = feedXML(
      'Ramona',
      dirEntry('Kids', '/books/Kids/?opds') +
        bookEntry('urn:uuid:ramona-1', 'Ramona.epub', '/dl/ramona.epub'),
    );

    const items = await checkFeedForNewItems(makeCatalog(), emptyState());
    expect(items.map((i) => i.entryId).sort()).toEqual(['urn:uuid:ramona-1', 'urn:uuid:rosie']);
    // Root fetched exactly once.
    const rootFetches = vi.mocked(fetchWithAuth).mock.calls.filter((c) => c[0] === BASE);
    expect(rootFetches).toHaveLength(1);
  });

  it('returns a subdirectory book only once when listed in two feeds', async () => {
    feeds[BASE] = feedXML(
      'Kids',
      dirEntry('Ramona', '/books/Kids/Ramona/?opds') +
        bookEntry('urn:uuid:dup', 'Dup.epub', '/dl/dup.epub'),
    );
    feeds[RAMONA_URL] = feedXML('Ramona', bookEntry('urn:uuid:dup', 'Dup.epub', '/dl/dup.epub'));

    const items = await checkFeedForNewItems(makeCatalog(), emptyState());
    expect(items.filter((i) => i.entryId === 'urn:uuid:dup')).toHaveLength(1);
  });

  it('skips already-known entries found in subdirectories', async () => {
    feeds[BASE] = feedXML('Kids', dirEntry('Ramona', '/books/Kids/Ramona/?opds'));
    feeds[RAMONA_URL] = feedXML(
      'Ramona',
      bookEntry('urn:uuid:known', 'Known.epub', '/dl/known.epub') +
        bookEntry('urn:uuid:fresh', 'Fresh.epub', '/dl/fresh.epub'),
    );

    const state = { ...emptyState(), knownEntryIds: ['urn:uuid:known'] };
    const items = await checkFeedForNewItems(makeCatalog(), state);
    expect(items.map((i) => i.entryId)).toEqual(['urn:uuid:fresh']);
  });

  it('follows rel=next pagination inside crawled subdirectories', async () => {
    const PAGE2 = 'https://files.example.com/books/Kids/Ramona/?opds&page=2';
    feeds[BASE] = feedXML('Kids', dirEntry('Ramona', '/books/Kids/Ramona/?opds'));
    feeds[RAMONA_URL] = feedXML(
      'Ramona',
      bookEntry('urn:uuid:p1', 'Page1.epub', '/dl/p1.epub'),
      `<link rel="next" href="/books/Kids/Ramona/?opds&amp;page=2" type="application/atom+xml;profile=opds-catalog"/>`,
    );
    feeds[PAGE2] = feedXML('Ramona p2', bookEntry('urn:uuid:p2', 'Page2.epub', '/dl/p2.epub'));

    const items = await checkFeedForNewItems(makeCatalog(), emptyState());
    expect(items.map((i) => i.entryId).sort()).toEqual(['urn:uuid:p1', 'urn:uuid:p2']);
  });
});

describe('getSubsectionURLs', () => {
  const baseURL = 'https://files.example.com/books/Kids/?opds';

  it('returns resolved URLs for subsection navigation entries', () => {
    const feed: OPDSFeed = {
      metadata: { title: 'Kids' },
      links: [],
      navigation: [
        {
          title: 'Ramona/',
          href: '/books/Kids/Ramona/?opds',
          rel: 'subsection',
          type: 'application/atom+xml;profile=opds-catalog',
          properties: {},
        },
      ],
    };
    expect(getSubsectionURLs(feed, baseURL)).toEqual([RAMONA_URL]);
  });

  it('accepts navigation entries without a type', () => {
    const feed: OPDSFeed = {
      metadata: { title: 'Kids' },
      links: [],
      navigation: [{ title: 'Sub', href: 'Sub/?opds', properties: {} }],
    };
    expect(getSubsectionURLs(feed, baseURL)).toEqual([
      'https://files.example.com/books/Kids/Sub/?opds',
    ]);
  });

  it('skips entries with non-catalog types', () => {
    const feed: OPDSFeed = {
      metadata: { title: 'Kids' },
      links: [],
      navigation: [{ title: 'Readme', href: '/readme.html', type: 'text/html', properties: {} }],
    };
    expect(getSubsectionURLs(feed, baseURL)).toEqual([]);
  });

  it('skips facet, self, up, search and start rels', () => {
    const catalogType = 'application/atom+xml;profile=opds-catalog';
    const feed: OPDSFeed = {
      metadata: { title: 'Kids' },
      links: [],
      navigation: [
        {
          title: 'F',
          href: '/f',
          rel: 'http://opds-spec.org/facet',
          type: catalogType,
          properties: {},
        },
        { title: 'S', href: '/s', rel: 'self', type: catalogType, properties: {} },
        { title: 'U', href: '/u', rel: 'up', type: catalogType, properties: {} },
        { title: 'Q', href: '/q', rel: 'search', type: catalogType, properties: {} },
        { title: 'T', href: '/t', rel: 'start', type: catalogType, properties: {} },
      ],
    };
    expect(getSubsectionURLs(feed, baseURL)).toEqual([]);
  });

  it('returns empty for feeds without navigation', () => {
    const feed: OPDSFeed = { metadata: { title: 'Kids' }, links: [] };
    expect(getSubsectionURLs(feed, baseURL)).toEqual([]);
  });
});
