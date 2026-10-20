import { describe, expect, it, vi } from 'vitest';
import type { ClientOptions } from '@tauri-apps/plugin-http';
import { allowsSelfSignedCert, tlsFetch, tlsFetchOptions } from '@/utils/tls';

describe('allowsSelfSignedCert', () => {
  it('keeps accepting self-signed certs for a server saved before the option existed', () => {
    expect(allowsSelfSignedCert({})).toBe(true);
  });

  it('follows an explicit choice', () => {
    expect(allowsSelfSignedCert({ allowSelfSignedCert: false })).toBe(false);
    expect(allowsSelfSignedCert({ allowSelfSignedCert: true })).toBe(true);
  });
});

describe('tlsFetchOptions', () => {
  it('relaxes certificate checks only when allowed', () => {
    expect(tlsFetchOptions(true)).toEqual({
      danger: { acceptInvalidCerts: true, acceptInvalidHostnames: true },
    });
    expect(tlsFetchOptions(false)).toEqual({});
  });
});

describe('tlsFetch', () => {
  const relaxed = { danger: { acceptInvalidCerts: true, acceptInvalidHostnames: true } };
  const redirect = (status: number, location: string) =>
    new Response(null, { status, headers: { Location: location } });
  const respond = (...responses: Response[]) => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit & ClientOptions) => {
      const res = responses.shift();
      if (!res) throw new Error('unexpected request');
      return res;
    });
    return fetch;
  };

  it('leaves a verified request to the client, redirects included', async () => {
    const fetch = respond(new Response('ok'));
    await tlsFetch(fetch, 'https://books.lan/feed', { method: 'GET' }, false);
    expect(fetch).toHaveBeenCalledWith('https://books.lan/feed', { method: 'GET' });
  });

  it('passes a web proxy path through, where the browser follows redirects itself', async () => {
    const fetch = respond(new Response('feed'));
    const res = await tlsFetch(fetch, '/api/opds/proxy?url=x', {}, true);
    expect(await res.text()).toBe('feed');
  });

  it('keeps accepting self-signed certificates on redirects within the origin', async () => {
    const fetch = respond(redirect(302, '/opds/root'), new Response('feed'));
    const res = await tlsFetch(fetch, 'https://books.lan/opds', {}, true);
    expect(await res.text()).toBe('feed');
    expect(fetch.mock.calls.map(([url, init]) => [url, init.danger, init.maxRedirections])).toEqual(
      [
        ['https://books.lan/opds', relaxed.danger, 0],
        ['https://books.lan/opds/root', relaxed.danger, 0],
      ],
    );
  });

  it('verifies a redirect to another origin and sends it no credentials', async () => {
    const fetch = respond(redirect(302, 'https://cdn.example.com/book.epub'), new Response('epub'));
    const headers = { Authorization: 'Basic dTpw', Cookie: 's=1', Accept: '*/*' };
    const res = await tlsFetch(fetch, 'https://books.lan/get/1', { headers }, true);
    expect(await res.text()).toBe('epub');
    const [url, init] = fetch.mock.calls[1]!;
    expect(url).toBe('https://cdn.example.com/book.epub');
    expect(init.danger).toBeUndefined();
    expect(init.maxRedirections).toBeUndefined();
    expect(init.headers).toEqual({ accept: '*/*' });
  });

  it('turns a redirected POST into a GET unless the status keeps the method', async () => {
    const fetch = respond(
      redirect(303, '/done'),
      new Response('ok'),
      redirect(307, '/retry'),
      new Response('ok'),
    );
    await tlsFetch(fetch, 'https://books.lan/sync', { method: 'POST', body: '{}' }, true);
    await tlsFetch(fetch, 'https://books.lan/sync', { method: 'POST', body: '{}' }, true);
    expect(fetch.mock.calls.map(([, init]) => [init.method, init.body])).toEqual([
      ['POST', '{}'],
      ['GET', undefined],
      ['POST', '{}'],
      ['POST', '{}'],
    ]);
  });

  it('gives up on a redirect loop', async () => {
    const fetch = vi.fn(async () => redirect(302, '/loop'));
    await expect(tlsFetch(fetch, 'https://books.lan/loop', {}, true)).rejects.toThrow(
      'Too many redirects',
    );
  });
});
