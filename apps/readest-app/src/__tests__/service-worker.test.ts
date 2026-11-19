// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { PAGES_CACHE_NAME } from '@serwist/next/worker';

const ORIGIN = 'https://reader.example.test';
const DAY_MS = 24 * 60 * 60 * 1000;

type CachedResponseWillBeUsed = (options: {
  cacheName: string;
  cachedResponse?: Response;
  event: unknown;
}) => Promise<Response | null | undefined>;
type Route = {
  matcher: (options: { url: URL; request: Pick<Request, 'mode'> }) => boolean;
  handler: {
    options: {
      cacheName?: string;
      plugins?: { cachedResponseWillBeUsed?: CachedResponseWillBeUsed }[];
    };
  };
};

// Record what sw.ts hands to Serwist instead of running Serwist itself.
const serwist = vi.hoisted(() => ({ runtimeCaching: [] as Route[] }));
vi.mock('serwist', async (importOriginal) => {
  class Recorded {
    constructor(readonly options: unknown) {}
  }
  return {
    ...(await importOriginal<typeof import('serwist')>()),
    Serwist: class {
      constructor(options: { runtimeCaching: Route[] }) {
        serwist.runtimeCaching = options.runtimeCaching;
      }
      addEventListeners() {}
    },
    NetworkFirst: Recorded,
    CacheFirst: Recorded,
    ExpirationPlugin: Recorded,
  };
});

// Cache Storage in memory, with the lookups sw.ts uses.
class MemoryCache {
  readonly entries = new Map<string, Response>();
  async match(request: Request | string, options?: { ignoreSearch?: boolean }) {
    const url = new URL(typeof request === 'string' ? request : request.url);
    for (const [key, response] of this.entries) {
      const saved = new URL(key);
      const same = options?.ignoreSearch
        ? saved.origin + saved.pathname === url.origin + url.pathname
        : saved.href === url.href;
      if (same) return response;
    }
    return undefined;
  }
  async put(url: string, response: Response) {
    this.entries.set(url, response);
  }
  async keys() {
    return [...this.entries.keys()].map((url) => new Request(url));
  }
  async delete(request: Request) {
    return this.entries.delete(request.url);
  }
}
const store = new Map<string, MemoryCache>();
const caches = {
  async open(name: string) {
    if (!store.has(name)) store.set(name, new MemoryCache());
    return store.get(name)!;
  },
  async has(name: string) {
    return store.has(name);
  },
  async delete(name: string) {
    return store.delete(name);
  },
  async match(request: Request | string, options: { cacheName: string; ignoreSearch?: boolean }) {
    return store.get(options.cacheName)?.match(request, options);
  },
};

class FetchEvent {
  readonly request: Request;
  constructor(_type: string, init: { request: Request }) {
    this.request = init.request;
  }
}

type Listener = (event: { waitUntil: (promise: Promise<unknown>) => void }) => void;
const listeners = new Map<string, Listener>();
const registration: { active: object | null } = { active: null };
const fire = async (type: string) => {
  const pending: Promise<unknown>[] = [];
  listeners.get(type)?.({ waitUntil: (promise) => pending.push(promise) });
  await Promise.all(pending);
};

const routeFor = (path: string, mode: RequestMode = 'navigate') =>
  serwist.runtimeCaching.find(({ matcher }) =>
    matcher({ url: new URL(path, ORIGIN), request: { mode } }),
  );
const savedBody = async (path: string) =>
  (await (await caches.open(PAGES_CACHE_NAME.html)).match(`${ORIGIN}${path}`))?.text();
const saved = (body: string, ageMs = 0) =>
  new Response(body, { headers: { date: new Date(Date.now() - ageMs).toUTCString() } });

beforeAll(async () => {
  vi.stubGlobal('self', {
    __SW_MANIFEST: [],
    registration,
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
  });
  vi.stubGlobal('caches', caches);
  vi.stubGlobal('FetchEvent', FetchEvent);
  await import('@/sw');
});

beforeEach(() => {
  store.clear();
  registration.active = null;
});

describe('service worker page cache', () => {
  // cacheOnNavigation (next.config.mjs) saves the pages opened through the
  // router to `pages`, so offline navigations have to read from there.
  test('reads the app pages from the cache cacheOnNavigation fills', () => {
    for (const path of ['/', '/library', '/reader/a1b2']) {
      expect(routeFor(path)?.handler.options.cacheName, `the cache read for ${path}`).toBe(
        PAGES_CACHE_NAME.html,
      );
    }
  });

  test('leaves other requests to the other routes', () => {
    expect(
      routeFor('/reader/a1b2', 'cors')?.handler.options.cacheName,
      'a fetch of a reader page that is not a navigation',
    ).not.toBe(PAGES_CACHE_NAME.html);
    expect(
      routeFor('/user')?.handler.options.cacheName,
      'a navigation outside the library and the reader',
    ).not.toBe(PAGES_CACHE_NAME.html);
  });

  // In a tab the reader is saved under its full /reader/<ids> path, which the
  // first-segment cache key doesn't match.
  test('falls back to the full reader path, within the age limit', async () => {
    const fallback = routeFor('/reader/a1b2')?.handler.options.plugins?.find(
      (plugin) => plugin.cachedResponseWillBeUsed,
    )?.cachedResponseWillBeUsed;
    expect(fallback, 'a fallback for pages the cache key misses').toBeDefined();

    const pages = await caches.open(PAGES_CACHE_NAME.html);
    await pages.put(`${ORIGIN}/reader/a1b2`, saved('fresh'));
    await pages.put(`${ORIGIN}/reader/c3d4`, saved('expired', 366 * DAY_MS));
    const lookUp = (path: string) =>
      fallback!({
        cacheName: PAGES_CACHE_NAME.html,
        event: new FetchEvent('fetch', { request: new Request(`${ORIGIN}${path}`) }),
      });

    expect(await (await lookUp('/reader/a1b2?x=1'))?.text()).toBe('fresh');
    expect(await lookUp('/reader/c3d4'), 'a page past the age limit').toBeNull();
  });

  test('clears the saved pages when a new worker replaces an old one', async () => {
    await (await caches.open(PAGES_CACHE_NAME.html)).put(`${ORIGIN}/library`, saved('library'));
    const general = await caches.open('offline-cache');
    await general.put(`${ORIGIN}/reader/a1b2`, saved('reader'));
    await general.put(`${ORIGIN}/_next/static/chunks/app.js`, saved('chunk'));
    registration.active = {};

    await fire('install');
    await fire('activate');

    expect(await caches.has(PAGES_CACHE_NAME.html), 'the saved pages are cleared').toBe(false);
    expect((await general.keys()).map(({ url }) => url)).toEqual([
      `${ORIGIN}/_next/static/chunks/app.js`,
    ]);
  });

  test('keeps the saved pages on a first install', async () => {
    await (await caches.open(PAGES_CACHE_NAME.html)).put(`${ORIGIN}/library`, saved('library'));

    await fire('install');
    // The browser makes the new worker the active one before activate.
    registration.active = {};
    await fire('activate');

    expect(await savedBody('/library'), 'the saved pages are kept').toBe('library');
  });

  // A worker whose install fails never activates, and the old one keeps
  // serving the pages it saved.
  test('keeps the saved pages while a new worker installs', async () => {
    await (await caches.open(PAGES_CACHE_NAME.html)).put(`${ORIGIN}/library`, saved('library'));
    registration.active = {};

    await fire('install');

    expect(await savedBody('/library'), 'the saved pages are kept').toBe('library');
  });
});
