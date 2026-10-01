import type {
  CalibreBookJson,
  CalibreFlavor,
  CalibreLibraryInfo,
  CalibrePosition,
  CalibreSearchResult,
  CalibreServer,
} from '@/types/calibre';
import { isTauriAppPlatform } from '@/services/environment';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { fetchWithAuth, needsProxy, probeAuth } from '@/app/opds/utils/opdsReq';
import { parseCalibreWebFeed, parseCalibreWebNav } from '@/services/calibre/calibreWebClient';
import type { CalibreServerBook } from '@/services/calibre/librarySync';

/** Safety cap for the Calibre-Web OPDS page walk (per page ~20-60 books). */
const MAX_FEED_PAGES = 2000;
/** Safety cap for the shelf walk. */
const MAX_SHELVES = 200;
/** Metadata batch size for GET /ajax/books?ids=... (URL length safety). */
const METADATA_BATCH_SIZE = 50;

/**
 * Platform fetch resolved at call time (never at module scope): this module
 * is part of the library page's import graph, which Next.js also evaluates
 * on the server during the web build, where `window` does not exist.
 */
const platformFetch = (): typeof fetch => (isTauriAppPlatform() ? tauriFetch : window.fetch);

/** Fetch error carrying the HTTP status, so flavor detection can read it. */
export class CalibreHttpError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * Client for the official Calibre content server JSON API
 * (calibre/src/calibre/srv/{ajax,books,content}.py). Auth reuses the OPDS
 * machinery (Basic preemptive + Digest challenge retry, including calibre's
 * 400-rejects-Basic quirk in digest mode). On the web platform requests go
 * through the OPDS proxy, which supports Basic auth only.
 */
export class CalibreClient {
  private server: CalibreServer;
  /**
   * The detected server flavor. Initialized from the persisted row and
   * refined by getLibraryInfo; callers persist it back via updateServer.
   */
  private flavor: CalibreFlavor | undefined;
  /**
   * A Basic Authorization header that already authenticated once. Reusable
   * verbatim across requests; Digest headers are bound to one request URI
   * (the response hash covers uri) so they are renegotiated per request via
   * fetchWithAuth instead of being cached.
   */
  private cachedBasicAuth: string | null = null;
  /** Set after the one-time auth-scheme probe so it never runs again. */
  private authProbed = false;

  constructor(server: CalibreServer) {
    this.server = server;
    this.flavor = server.flavor;
  }

  /** Base URL without trailing slash; user-supplied path prefixes survive. */
  private base(): string {
    return this.server.url.trim().replace(/\/+$/, '');
  }

  /** Library id for a URL path segment (library ids are folder names, so escape them). */
  private static libSeg(libraryId: string): string {
    return encodeURIComponent(libraryId);
  }

  private buildUrl(path: string, params?: Record<string, string | number | undefined>): string {
    let url = `${this.base()}${path}`;
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value !== undefined && value !== '') search.set(key, String(value));
    }
    const qs = search.toString();
    if (qs) url += `?${qs}`;
    return url;
  }

  private async fetchJSON<T>(path: string, params?: Record<string, string | number | undefined>) {
    const res = await this.authedFetch(this.buildUrl(path, params), {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new CalibreHttpError(`Calibre request failed: ${path} -> ${res.status}`, res.status);
    }
    return (await res.json()) as T;
  }

  private rawFetch(url: string, options: RequestInit): Promise<Response> {
    return platformFetch()(url, {
      ...options,
      // Calibre self-hosted deployments commonly run self-signed certificates.
      danger: { acceptInvalidCerts: true, acceptInvalidHostnames: true },
    } as RequestInit);
  }

  /**
   * Authenticated request with a cached-Basic fast path. Anything not 401/400
   * returns directly; otherwise the cache is dropped and fetchWithAuth
   * renegotiates the scheme the server actually wants (calibre's digest mode
   * answers a Basic header with 400, see fetchWithAuth). Public because
   * small authenticated downloads (covers) ride it directly.
   */
  async authedFetch(url: string, options: RequestInit = {}): Promise<Response> {
    // The cached fast path hits the server URL directly from this client, so
    // it must not bypass the web platform's OPDS proxy routing — a proxied
    // request fired with the original URL from the browser just fails CORS.
    if (this.cachedBasicAuth && !needsProxy(url)) {
      const res = await this.rawFetch(url, {
        ...options,
        headers: {
          ...(options.headers as Record<string, string>),
          Authorization: this.cachedBasicAuth,
        },
      });
      if (res.status !== 401 && res.status !== 400) return res;
      this.cachedBasicAuth = null;
    }
    const res = await fetchWithAuth(
      url,
      this.server.username,
      this.server.password,
      needsProxy(url),
      options,
    );
    if (res.ok && this.server.username && this.server.password && !this.authProbed) {
      // One-time scheme probe after the first authenticated request: a Basic
      // header is reusable verbatim across requests, a Digest one is bound to
      // its request uri (the response hash covers uri), so only Basic gets
      // cached and digest keeps renegotiating via fetchWithAuth.
      this.authProbed = true;
      try {
        const auth = await probeAuth(
          this.buildUrl('/ajax/library-info'),
          this.server.username,
          this.server.password,
          needsProxy(this.server.url),
        );
        if (auth?.startsWith('Basic ')) this.cachedBasicAuth = auth;
      } catch {
        // Cache stays empty; fetchWithAuth remains the correct path.
      }
    }
    return res;
  }

  /**
   * Library list + default library, with server-flavor detection.
   *
   * The official calibre-server answers /ajax/library-info; Calibre-Web (a
   * Flask app whose login form sits where HTTP auth would be) 404s it and
   * only exposes its library through the OPDS feed. Detection: official
   * first; a 404 flips the client to calibre-web after confirming /opds.
   */
  async getLibraryInfo(): Promise<CalibreLibraryInfo> {
    if (this.flavor === 'calibre-web') return this.calibreWebLibraryInfo();
    let official: Omit<CalibreLibraryInfo, 'flavor'>;
    try {
      const data = await this.fetchJSON<{
        library_map: Record<string, string>;
        default_library: string;
      }>('/ajax/library-info');
      const libraries = Object.entries(data.library_map ?? {}).map(([id, name]) => ({
        id,
        name: name || id,
      }));
      official = { libraries, defaultLibraryId: data.default_library };
      this.flavor = 'calibre';
      return { ...official, flavor: 'calibre' };
    } catch (error) {
      // Anything other than a clean 404 (auth failure, network error, HTML
      // from a proxy) is a real failure, not a flavor signal.
      if (!(error instanceof CalibreHttpError) || error.status !== 404) throw error;
    }
    await this.confirmCalibreWeb();
    return this.calibreWebLibraryInfo();
  }

  private calibreWebLibraryInfo(): CalibreLibraryInfo {
    return {
      libraries: [{ id: 'calibre-web', name: 'Calibre-Web' }],
      defaultLibraryId: 'calibre-web',
      flavor: 'calibre-web',
    };
  }

  private async confirmCalibreWeb(): Promise<void> {
    this.flavor = 'calibre-web';
    const res = await this.authedFetch(this.buildUrl('/opds'), {
      headers: { Accept: 'application/atom+xml' },
    });
    if (res.ok) return;
    if (res.status === 401) {
      throw new Error('Calibre-Web OPDS authentication failed. Check the username and password.');
    }
    throw new Error(
      'Calibre-Web OPDS feed is not reachable. Enable OPDS and basic authentication on the server.',
    );
  }

  /** GET /ajax/search -> one page of matching book ids. */
  async searchBookIds(
    libraryId: string,
    opts: {
      query?: string;
      sort?: string;
      sortOrder?: 'asc' | 'desc';
      num?: number;
      offset?: number;
    } = {},
  ): Promise<CalibreSearchResult> {
    return this.fetchJSON<CalibreSearchResult>(`/ajax/search/${CalibreClient.libSeg(libraryId)}`, {
      query: opts.query,
      sort: opts.sort,
      sort_order: opts.sortOrder,
      num: opts.num,
      offset: opts.offset,
    });
  }

  /**
   * All book ids in the library, paged. The server caps `num` per response,
   * so loop on `offset` until a page comes back short; an explicit large
   * `total_num` bounds the loop against misbehaving servers.
   */
  async getAllBookIds(libraryId: string, pageSize = 500): Promise<number[]> {
    const ids: number[] = [];
    let offset = 0;
    let total = Number.POSITIVE_INFINITY;
    while (offset < total) {
      const page = await this.searchBookIds(libraryId, { num: pageSize, offset });
      const batch = page.book_ids ?? [];
      ids.push(...batch);
      total = typeof page.total_num === 'number' ? page.total_num : offset + batch.length;
      if (batch.length === 0) break;
      offset += batch.length;
    }
    return ids;
  }

  /** GET /ajax/books?ids=... -> { bookId: bookJson | null } (restricted books are null). */
  async getBooks(
    libraryId: string,
    bookIds: number[],
  ): Promise<Record<string, CalibreBookJson | null>> {
    if (bookIds.length === 0) return {};
    return this.fetchJSON<Record<string, CalibreBookJson | null>>(
      `/ajax/books/${CalibreClient.libSeg(libraryId)}`,
      { ids: bookIds.join(','), id_is_uuid: 'false' },
    );
  }

  /** Authenticated thumbnail/cover URL for grid covers. */
  buildThumbUrl(libraryId: string, bookId: string | number, size = '400x600'): string {
    if (this.flavor === 'calibre-web') {
      // Calibre-Web's fixed-size renditions; the plain cover is the fallback.
      return this.buildUrl(`/opds/cover_240_240/${bookId}`);
    }
    return this.buildUrl(`/get/thumb/${bookId}/${CalibreClient.libSeg(libraryId)}`, { sz: size });
  }

  /** Authenticated full cover URL. */
  buildCoverUrl(libraryId: string, bookId: string | number): string {
    if (this.flavor === 'calibre-web') {
      return this.buildUrl(`/opds/cover/${bookId}`);
    }
    return this.buildUrl(`/get/cover/${bookId}/${CalibreClient.libSeg(libraryId)}`);
  }

  /** Authenticated download URL for one format (lowercase ext, e.g. `epub`). */
  buildDownloadUrl(libraryId: string, bookId: string | number, fmt: string): string {
    if (this.flavor === 'calibre-web') {
      // The route is declared with a trailing slash; Flask would redirect
      // /opds/download/12/epub to the slashed form, but keep it exact.
      return this.buildUrl(`/opds/download/${bookId}/${fmt.toLowerCase()}/`);
    }
    return this.buildUrl(`/get/${fmt.toLowerCase()}/${bookId}/${CalibreClient.libSeg(libraryId)}`);
  }

  /**
   * Calibre-Web user/public shelves (/opds/shelfindex → /opds/shelf/<id>),
   * as name + contained book ids. Only available in the calibre-web flavor;
   * official servers have no shelf concept over HTTP.
   */
  async getShelves(): Promise<{ name: string; bookIds: string[] }[]> {
    if (this.flavor !== 'calibre-web') return [];
    const shelves: { name: string; href: string }[] = [];
    let indexHref: string | undefined = '/opds/shelfindex';
    const seenIndex = new Set<string>();
    for (let page = 0; indexHref && page < MAX_FEED_PAGES; page++) {
      if (seenIndex.has(indexHref)) break;
      seenIndex.add(indexHref);
      const res = await this.authedFetch(this.buildUrl(indexHref), {
        headers: { Accept: 'application/atom+xml' },
      });
      if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) break;
      const nav = parseCalibreWebNav(await res.text(), /\/opds\/shelf\/(\d+)/);
      shelves.push(...nav.links.map((link) => ({ name: link.title, href: link.href })));
      indexHref = nav.nextHref;
    }

    const result: { name: string; bookIds: string[] }[] = [];
    for (const shelf of shelves.slice(0, MAX_SHELVES)) {
      let href: string | undefined = shelf.href;
      const seen = new Set<string>();
      const bookIds: string[] = [];
      for (let page = 0; href && page < MAX_FEED_PAGES; page++) {
        if (seen.has(href)) break;
        seen.add(href);
        const res = await this.authedFetch(this.buildUrl(href), {
          headers: { Accept: 'application/atom+xml' },
        });
        if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) break;
        const feed = parseCalibreWebFeed(await res.text());
        bookIds.push(...feed.entries.map((entry) => entry.id));
        href = feed.nextHref;
      }
      if (bookIds.length > 0) result.push({ name: shelf.name, bookIds });
    }
    return result;
  }

  /**
   * Cheap book count for the auto-sync change probe: official servers expose
   * total_num on a minimal search, calibre-web has /opds/stats. Returns
   * undefined when the probe isn't available.
   */
  async getBookCount(libraryId: string): Promise<number | undefined> {
    if (this.flavor === 'calibre-web') {
      const stats = await this.fetchJSON<{ books?: number }>('/opds/stats');
      return typeof stats.books === 'number' ? stats.books : undefined;
    }
    const page = await this.searchBookIds(libraryId, { num: 1 });
    return typeof page.total_num === 'number' ? page.total_num : undefined;
  }

  /**
   * Every book in the library with metadata. Official servers go through the
   * /ajax search + batch metadata API; Calibre-Web has no batch JSON API, so
   * the OPDS acquisition feed is walked page by page (each entry already
   * carries full metadata). `onProgress` reports books fetched so far and —
   * when the server exposes a count — the total.
   */
  async listAllBooks(
    libraryId: string,
    onProgress?: (fetched: number, total?: number) => void,
  ): Promise<CalibreServerBook[]> {
    if (this.flavor === 'calibre-web') return this.listCalibreWebBooks(onProgress);
    const bookIds = await this.getAllBookIds(libraryId);
    onProgress?.(0, bookIds.length);
    const serverBooks: CalibreServerBook[] = [];
    for (let i = 0; i < bookIds.length; i += METADATA_BATCH_SIZE) {
      const batch = bookIds.slice(i, i + METADATA_BATCH_SIZE);
      const metadata = await this.getBooks(libraryId, batch);
      for (const id of batch) {
        const json = metadata[String(id)];
        if (json) serverBooks.push({ id: String(id), json });
      }
      // Progress tracks processed books; restricted books (null metadata)
      // still count as processed.
      onProgress?.(Math.min(i + METADATA_BATCH_SIZE, bookIds.length), bookIds.length);
    }
    return serverBooks;
  }

  /**
   * Walk Calibre-Web's "all books" OPDS feed (/opds/books/letter/00 serves
   * every book regardless of the letter filter) following the server's own
   * rel="next" links — calibre-web derives the page index from the offset,
   * so only its computed hrefs are safe to request. The total comes from
   * /opds/stats when available; the feed itself carries no count.
   */
  private async listCalibreWebBooks(
    onProgress?: (fetched: number, total?: number) => void,
  ): Promise<CalibreServerBook[]> {
    let total: number | undefined;
    try {
      const stats = await this.fetchJSON<{ books?: number }>('/opds/stats');
      if (typeof stats.books === 'number' && stats.books > 0) total = stats.books;
    } catch {
      // Stats are optional; the walk reports fetched counts regardless.
    }
    onProgress?.(0, total);
    const books: CalibreServerBook[] = [];
    let href: string | undefined = '/opds/books/letter/00';
    const seen = new Set<string>();
    for (let page = 0; href && page < MAX_FEED_PAGES; page++) {
      if (seen.has(href)) break; // defensive: a broken next link must not loop
      seen.add(href);
      const res = await this.authedFetch(this.buildUrl(href), {
        headers: { Accept: 'application/atom+xml' },
      });
      if (!res.ok) {
        throw new CalibreHttpError(`Calibre-Web feed request failed -> ${res.status}`, res.status);
      }
      if ((res.headers.get('content-type') ?? '').includes('text/html')) {
        throw new Error(
          'Calibre-Web OPDS feed is not reachable. Enable OPDS and basic authentication on the server.',
        );
      }
      const text = await res.text();
      let feed;
      try {
        feed = parseCalibreWebFeed(text);
      } catch (error) {
        // Surface the page so a broken feed (usually one book's unescaped
        // metadata) can be found and fixed on the server.
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${message} (while reading ${href})`);
      }
      books.push(...feed.entries);
      onProgress?.(books.length, total);
      href = feed.nextHref;
    }
    return books;
  }

  /**
   * GET /book-get-last-read-position -> positions keyed `"<bookId>:<fmt>"`.
   * `which` lists the pairs to query in the server's wire form
   * `bookId1-fmt1_bookId2-fmt2` (srv/books.py splits on `_`, pairs on `-`).
   * Official servers only — calibre-web has no position API, and the caller
   * guards on flavor before reaching here.
   */
  async getLastReadPosition(
    libraryId: string,
    which: string[],
  ): Promise<Record<string, CalibrePosition[]>> {
    if (which.length === 0 || this.flavor === 'calibre-web') return {};
    return this.fetchJSON<Record<string, CalibrePosition[]>>(
      `/book-get-last-read-position/${CalibreClient.libSeg(libraryId)}/${which.join('_')}`,
    );
  }

  /** POST /book-set-last-read-position — store a per-user reading position. */
  async setLastReadPosition(
    libraryId: string,
    bookId: string | number,
    fmt: string,
    position: { device: string; cfi: string; pos_frac: number },
  ): Promise<void> {
    if (this.flavor === 'calibre-web') return; // no position API
    const res = await this.authedFetch(
      this.buildUrl(
        `/book-set-last-read-position/${CalibreClient.libSeg(libraryId)}/${bookId}/${fmt.toLowerCase()}`,
      ),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(position),
      },
    );
    if (!res.ok) {
      throw new Error(`Calibre position push failed: ${res.status}`);
    }
  }
}

/** A fresh client for the server row; the row's current credentials are read per request. */
export const createCalibreClient = (server: CalibreServer): CalibreClient =>
  new CalibreClient(server);
