import type { LookupAddress, LookupAllOptions } from 'node:dns';
import type { Agent as HttpAgent } from 'node:http';
import type { Agent as HttpsAgent } from 'node:https';
import type { LookupFunction } from 'node:net';
import type { Transform } from 'node:stream';
import { isBlockedHost } from '@/utils/network';

export type PublicFetchInit = {
  method?: string;
  headers?: HeadersInit;
  body?: string | null;
  signal?: AbortSignal;
  /** Give up when the socket sees no traffic for this long. */
  idleTimeoutMs?: number;
};

// Matches undici's default headers/body timeouts, which the platform fetch
// applied before requests moved to node:http.
const DEFAULT_IDLE_TIMEOUT_MS = 300_000;

type LookupAll = (
  hostname: string,
  options: LookupAllOptions,
  callback: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
) => void;

const blockedError = (subject: string) =>
  Object.assign(new Error(`${subject} an internal address`), { code: 'EBLOCKEDADDRESS' });

/**
 * Wrap a DNS lookup so a connection is refused when the name resolves to any
 * loopback, private, link-local or otherwise internal address. Used as the
 * socket's `lookup`, so the address checked is the address connected to.
 */
export const createPublicLookup =
  (lookup: LookupAll): LookupFunction =>
  (hostname, options, callback) => {
    lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, '');
      if (!addresses.length || addresses.some(({ address }) => isBlockedHost(address))) {
        return callback(blockedError(`${hostname} resolves to`), '');
      }
      if (options.all) return callback(null, addresses);
      callback(null, addresses[0]!.address, addresses[0]!.family);
    });
  };

// One keep-alive pool per lookup, so a request never reuses a socket that was
// opened without its lookup.
const pools = new WeakMap<LookupFunction, { http: HttpAgent; https: HttpsAgent }>();
let publicLookup: LookupFunction | undefined;

/** Issue one request over node:http(s) with the given lookup. Never follows redirects. */
export async function fetchWithLookup(
  url: string,
  init: PublicFetchInit,
  lookup: LookupFunction,
): Promise<Response> {
  const [http, https, zlib, { Readable, pipeline }] = await Promise.all([
    import('node:http'),
    import('node:https'),
    import('node:zlib'),
    import('node:stream'),
  ]);
  let pool = pools.get(lookup);
  if (!pool) {
    pool = {
      http: new http.Agent({ keepAlive: true }),
      https: new https.Agent({ keepAlive: true }),
    };
    pools.set(lookup, pool);
  }
  const target = new URL(url);
  const isHttps = target.protocol === 'https:';
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (!headers.has('accept-encoding')) headers.set('accept-encoding', 'gzip, deflate, br');
  if (init.body != null) headers.set('content-length', String(Buffer.byteLength(init.body)));
  const decoders: Record<string, () => Transform> = {
    gzip: zlib.createGunzip,
    'x-gzip': zlib.createGunzip,
    deflate: zlib.createInflate,
    br: zlib.createBrotliDecompress,
  };

  return new Promise((resolve, reject) => {
    const request = (isHttps ? https : http).request(
      target,
      {
        method,
        headers: Object.fromEntries(headers),
        signal: init.signal,
        lookup,
        agent: isHttps ? pool.https : pool.http,
      },
      (res) => {
        const status = res.statusCode ?? 502;
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(res.headers)) {
          if (value === undefined) continue;
          for (const item of Array.isArray(value) ? value : [value]) {
            responseHeaders.append(name, item);
          }
        }
        if (method === 'HEAD' || [204, 205, 304].includes(status)) {
          res.resume();
          return resolve(new Response(null, { status, headers: responseHeaders }));
        }
        // fetch decodes compressed bodies transparently; match it.
        const decode = decoders[res.headers['content-encoding']?.trim().toLowerCase() ?? ''];
        const body = decode ? pipeline(res, decode(), () => {}) : res;
        resolve(
          new Response(Readable.toWeb(body) as ReadableStream<Uint8Array>, {
            status,
            headers: responseHeaders,
          }),
        );
      },
    );
    request.setTimeout(init.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS, () =>
      request.destroy(Object.assign(new Error('Request timed out'), { code: 'ETIMEDOUT' })),
    );
    request.on('error', reject);
    request.end(init.body ?? undefined);
  });
}

// The hosted web build runs on Cloudflare Workers: its fetch has no socket
// lookup hook, and Workers egress cannot reach private or loopback addresses,
// so the platform fetch is used there. Self-hosted servers run on Node.
const isNodeServer = () =>
  typeof window === 'undefined' &&
  globalThis.process?.release?.name === 'node' &&
  globalThis.navigator?.userAgent !== 'Cloudflare-Workers';

/**
 * Fetch a client-supplied URL that must only reach the public internet. On a
 * Node server the resolved address of every connection is checked, so a
 * public name pointing at an internal address (including DNS rebinding
 * between a check and the connect) is refused. Never follows redirects;
 * callers re-validate each hop.
 */
export async function publicFetch(url: string, init: PublicFetchInit): Promise<Response> {
  if (!isNodeServer()) return fetch(url, { ...init, redirect: 'manual' });
  const { hostname } = new URL(url);
  if (isBlockedHost(hostname)) throw blockedError(`${hostname} is`);
  const { default: dns } = await import('node:dns');
  publicLookup ??= createPublicLookup((name, options, callback) =>
    dns.lookup(name, options, callback),
  );
  return fetchWithLookup(url, init, publicLookup);
}
