import { PAGES_CACHE_NAME } from '@serwist/next/worker';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import { NetworkFirst, CacheFirst, ExpirationPlugin, Serwist } from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// The pages the app renders on the client: the library at `/` and `/library`,
// and the reader.
const isClientRoute = ({ pathname }: URL) =>
  pathname === '/' || ['/library', '/reader'].some((route) => pathname.startsWith(route));
const isAppPage = (url: URL) => url.origin === self.location.origin && isClientRoute(url);

// The page route reads `pages` by the first path segment, so one saved reader
// serves every book.
const pageCacheKey = ({ origin, pathname }: URL) => `${origin}/${pathname.split('/')[1]}`;

const PAGE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  disableDevLogs: true,
  fallbacks: {
    entries: [
      {
        url: '/offline',
        matcher({ request }) {
          return request.destination === 'document';
        },
      },
    ],
  },
  runtimeCaching: [
    {
      matcher: ({ url, request }) => isClientRoute(url) && request.mode === 'navigate',
      handler: new NetworkFirst({
        // `cacheOnNavigation` (next.config.mjs) saves the pages opened through the
        // router to this cache. Reading from it lets them load offline even when
        // the service worker has never handled a full page load of them.
        cacheName: PAGES_CACHE_NAME.html,
        networkTimeoutSeconds: 3,
        matchOptions: {
          ignoreSearch: true,
        },
        plugins: [
          new ExpirationPlugin({
            maxEntries: 128,
            maxAgeSeconds: PAGE_MAX_AGE_SECONDS,
          }),
          {
            cacheKeyWillBeUsed: async ({ request }) => pageCacheKey(new URL(request.url)),
          },
          {
            // In a browser tab the reader is at /reader/<ids>, and
            // cacheOnNavigation saves it under that full path, which the key
            // above doesn't match. ExpirationPlugin has already run by now, so
            // apply the same age limit to the page found here.
            cachedResponseWillBeUsed: async ({ cacheName, cachedResponse, event }) => {
              if (cachedResponse || !(event instanceof FetchEvent)) return cachedResponse;
              const match = await caches.match(event.request.url, {
                cacheName,
                ignoreSearch: true,
              });
              const savedAt = Date.parse(match?.headers.get('date') ?? '');
              if (savedAt < Date.now() - PAGE_MAX_AGE_SECONDS * 1000) return null;
              return match ?? null;
            },
          },
        ],
      }),
    },
    // Fonts: CacheFirst strategy for maximum performance
    {
      matcher: ({ url, request }) => {
        // Match font files by extension
        const isFontFile = /\.(woff2?|ttf|otf|eot|svg)(\?.*)?$/i.test(url.pathname);
        // Match font requests by destination
        const isFontRequest = request.destination === 'font';
        // Match Google Fonts CSS and font CDNs
        const isFontCDN =
          url.hostname === 'fonts.googleapis.com' ||
          url.hostname === 'fonts.gstatic.com' ||
          url.hostname === 'cdn.jsdelivr.net' ||
          url.hostname === 'cdnjs.cloudflare.com' ||
          url.hostname === 'ik.imagekit.io' ||
          url.hostname === 'db.onlinewebfonts.com';

        return isFontFile || isFontRequest || isFontCDN;
      },
      handler: new CacheFirst({
        cacheName: 'fonts-cache',
        plugins: [
          new ExpirationPlugin({
            maxEntries: 200, // More entries for various font files
            maxAgeSeconds: 365 * 24 * 60 * 60 * 2, // 2 years - fonts rarely change
            purgeOnQuotaError: true, // Automatically purge if storage quota exceeded
          }),
        ],
      }),
    },
    // Other external resources
    {
      matcher: ({ url }) => {
        if (url.pathname.startsWith('/api/')) {
          return false;
        }
        return /^https?.*/.test(url.href);
      },
      handler: new NetworkFirst({
        cacheName: 'offline-cache',
        networkTimeoutSeconds: 3,
        plugins: [
          new ExpirationPlugin({
            maxEntries: 512,
            maxAgeSeconds: 365 * 24 * 60 * 60,
          }),
        ],
      }),
    },
  ],
});

// A saved page loads the chunks of the build that served it, and a new service
// worker comes with a new build whose precache no longer has those chunks. Clear
// the saved pages once the new worker activates: if its install fails, the old
// worker keeps running and still needs them. A first install keeps the pages
// saved before it took control. The marker is a cache, not a variable, because
// the browser may stop the worker between install and activate.
const REPLACING_MARKER = 'replacing-service-worker';
self.addEventListener('install', (event) => {
  if (self.registration.active) event.waitUntil(caches.open(REPLACING_MARKER));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      if (!(await caches.has(REPLACING_MARKER))) return;
      const savedKinds = (await (await caches.open(PAGES_CACHE_NAME.html)).keys())
        .map(({ url }) => new URL(url))
        .filter(isAppPage)
        .map(pageCacheKey);
      await Promise.all([caches.delete(PAGES_CACHE_NAME.html), caches.delete('client-pages')]);
      // cacheOnNavigation refetches a page through the service worker, so an old
      // copy in the general cache could come back into `pages` on a slow network.
      const general = await caches.open('offline-cache');
      for (const request of await general.keys()) {
        if (isAppPage(new URL(request.url))) await general.delete(request);
      }
      // The visit that brought this worker saved its page just before the worker
      // took over. Save again from this build the pages the open windows loaded,
      // so the app still opens offline before it navigates again. A window
      // reports the URL it loaded, not one it moved to inside the app, so a book
      // opened from the library would be left out: also save each kind of page
      // saved before, under the key its route reads. A network that doesn't
      // answer in time leaves them to be saved on the next visit.
      const pages = await caches.open(PAGES_CACHE_NAME.html);
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const urls = new Set([
        ...open
          .map(({ url }) => new URL(url))
          .filter(isAppPage)
          .map(({ href }) => href),
        ...savedKinds,
      ]);
      await Promise.all(
        [...urls].map(async (url) => {
          try {
            const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
            if (response.ok) await pages.put(url, response);
          } catch {}
        }),
      );
      await caches.delete(REPLACING_MARKER);
    })(),
  );
});

serwist.addEventListeners();
