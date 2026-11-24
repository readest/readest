// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import dns from 'node:dns';
import zlib from 'node:zlib';
import type { AddressInfo } from 'node:net';
import { createPublicLookup, fetchWithLookup, publicFetch } from '@/utils/publicFetch';

type LookupResult = { address: string; family: number }[];

// A stand-in resolver that answers every name with the given records, the way
// an attacker-controlled DNS zone would.
const resolvingTo = (records: LookupResult): typeof dns.lookup =>
  ((_hostname: string, _options: unknown, callback: (...args: unknown[]) => void) =>
    callback(null, records)) as unknown as typeof dns.lookup;

const lookupWith = (lookup: ReturnType<typeof createPublicLookup>, all: boolean) =>
  new Promise<{ err: NodeJS.ErrnoException | null; address: unknown; family?: number }>((resolve) =>
    lookup('catalog.example', { all }, (err, address, family) => resolve({ err, address, family })),
  );

describe('createPublicLookup', () => {
  it('rejects a public name whose records point at loopback', async () => {
    const lookup = createPublicLookup(resolvingTo([{ address: '127.0.0.1', family: 4 }]));
    const { err } = await lookupWith(lookup, false);
    expect(err?.code).toBe('EBLOCKEDADDRESS');
  });

  it('rejects when any of several records is internal', async () => {
    const lookup = createPublicLookup(
      resolvingTo([
        { address: '93.184.215.14', family: 4 },
        { address: 'fd00::1', family: 6 },
      ]),
    );
    const { err } = await lookupWith(lookup, true);
    expect(err?.code).toBe('EBLOCKEDADDRESS');
  });

  it('rejects cloud metadata and IPv4-mapped loopback records', async () => {
    for (const address of ['169.254.169.254', '::ffff:127.0.0.1']) {
      const lookup = createPublicLookup(resolvingTo([{ address, family: 4 }]));
      const { err } = await lookupWith(lookup, false);
      expect(err?.code).toBe('EBLOCKEDADDRESS');
    }
  });

  it('passes public records through in the shape the caller asked for', async () => {
    const records = [
      { address: '93.184.215.14', family: 4 },
      { address: '2606:2800:21f:cb07:6820:80da:af6b:8b2c', family: 6 },
    ];
    const lookup = createPublicLookup(resolvingTo(records));
    expect(await lookupWith(lookup, true)).toEqual({ err: null, address: records });
    expect(await lookupWith(lookup, false)).toEqual({
      err: null,
      address: '93.184.215.14',
      family: 4,
    });
  });
});

describe('publicFetch on a Node server', () => {
  it('refuses a hostname that resolves to an internal address', async () => {
    const lookupSpy = vi
      .spyOn(dns, 'lookup')
      .mockImplementation(resolvingTo([{ address: '127.0.0.1', family: 4 }]));
    await expect(publicFetch('http://rebind.example:9/feed', {})).rejects.toThrow(
      /internal address/,
    );
    expect(lookupSpy).toHaveBeenCalled();
    lookupSpy.mockRestore();
  });

  it('refuses an internal host literal before resolving anything', async () => {
    const lookupSpy = vi.spyOn(dns, 'lookup');
    await expect(publicFetch('http://169.254.169.254/latest', {})).rejects.toThrow(
      /internal address/,
    );
    expect(lookupSpy).not.toHaveBeenCalled();
    lookupSpy.mockRestore();
  });
});

describe('fetchWithLookup', () => {
  let server: http.Server;
  let base: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/stall') {
        return; // accept the request and never answer
      } else if (req.url === '/redirect') {
        res.writeHead(302, { Location: '/target' });
        res.end();
      } else if (req.url === '/gzip') {
        res.writeHead(200, { 'Content-Type': 'text/xml', 'Content-Encoding': 'gzip' });
        res.end(zlib.gzipSync('<feed/>'));
      } else if (req.url === '/echo') {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          res.writeHead(201, { 'Content-Type': 'application/json', 'Set-Cookie': ['a=1', 'b=2'] });
          res.end(
            JSON.stringify({
              method: req.method,
              body,
              auth: req.headers['authorization'] ?? null,
              length: req.headers['content-length'] ?? null,
            }),
          );
        });
      } else {
        res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': '5' });
        res.end(req.method === 'HEAD' ? undefined : 'hello');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.closeAllConnections();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('sends the method, headers and body and returns status, headers and body', async () => {
    const res = await fetchWithLookup(
      `${base}/echo`,
      { method: 'POST', headers: { Authorization: 'Basic abc' }, body: '{"x":1}' },
      dns.lookup,
    );
    expect(res.status).toBe(201);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.getSetCookie()).toEqual(['a=1', 'b=2']);
    expect(await res.json()).toEqual({
      method: 'POST',
      body: '{"x":1}',
      auth: 'Basic abc',
      length: '7',
    });
  });

  it('returns redirects instead of following them', async () => {
    const res = await fetchWithLookup(`${base}/redirect`, {}, dns.lookup);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/target');
  });

  it('decodes compressed bodies like fetch does', async () => {
    const res = await fetchWithLookup(`${base}/gzip`, {}, dns.lookup);
    expect(await res.text()).toBe('<feed/>');
  });

  it('returns an empty body for HEAD', async () => {
    const res = await fetchWithLookup(`${base}/plain`, { method: 'HEAD' }, dns.lookup);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe('5');
    expect(res.body).toBeNull();
  });

  it('honors an abort signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      fetchWithLookup(`${base}/plain`, { signal: controller.signal }, dns.lookup),
    ).rejects.toThrow();
  });

  it('gives up on a server that stops responding', async () => {
    await expect(
      fetchWithLookup(`${base}/stall`, { idleTimeoutMs: 50 }, dns.lookup),
    ).rejects.toThrow(/timed out/);
  });

  it('refuses to connect when the resolver reports an internal address', async () => {
    await expect(
      fetchWithLookup(`${base}/plain`, {}, createPublicLookup(dns.lookup)),
    ).rejects.toThrow(/internal address/);
  });
});
