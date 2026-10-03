import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import handler from '@/pages/api/kosync';

vi.mock('@/utils/cors', () => ({ corsAllMethods: {}, runMiddleware: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());

const call = async (
  endpoint = '/users/auth',
  serverUrl = 'https://sync.example.com',
  options: { method?: 'GET' | 'POST' | 'PUT'; body?: unknown } = {},
) => {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), send: vi.fn() };
  await handler(
    {
      method: 'POST',
      body: { serverUrl, endpoint, method: 'GET', ...options },
    } as NextApiRequest,
    res as unknown as NextApiResponse,
  );
  return res;
};

describe('KOSync proxy boundaries', () => {
  it.each([
    'https://sync.example.com/admin?',
    'https://sync.example.com/?next=admin',
    'https://sync.example.com/#frag',
    'https://sync.example.com/admin',
    'https://sync.example.com/%ZZ',
    'https://user:password@sync.example.com',
  ])('rejects a non-origin server URL: %s', async (serverUrl) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    const res = await call('/users/auth', serverUrl);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid serverUrl' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    'https://sync.example.com',
    'https://sync.example.com/',
  ])('constructs the allowed endpoint from the origin: %s', async (serverUrl) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    const res = await call('/users/auth', serverUrl);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://sync.example.com/users/auth',
      expect.anything(),
    );
  });

  it('allows fetching progress for a document hash', async () => {
    const endpoint = '/syncs/progress/0123456789abcdef0123456789abcdef';
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"percentage":0.5}'));
    vi.stubGlobal('fetch', fetchMock);
    const res = await call(endpoint);
    expect(fetchMock).toHaveBeenCalledWith(
      `https://sync.example.com${endpoint}`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(res.json).toHaveBeenCalledWith({ percentage: 0.5 });
  });

  it.each([
    '../users/auth',
    '%2e%2e',
    'abc/extra',
    'abc?admin=true',
  ])('rejects malformed progress suffix %s', async (suffix) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await call(`/syncs/progress/${suffix}`);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects paths merely containing an allowed endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    const res = await call('/unrelated/users/auth/extra');
    expect(res.status).toHaveBeenCalledWith(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not follow a redirect to an internal service', async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      if (init.redirect !== 'manual') return new Response('internal secret');
      return new Response(null, { status: 307, headers: { location: 'http://127.0.0.1/admin' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await call();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).not.toHaveBeenCalledWith('internal secret');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves compatible same-origin redirects', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 307, headers: { location: '/users/auth/' } }),
      )
      .mockResolvedValueOnce(new Response('{"ok":true}'));
    vi.stubGlobal('fetch', fetchMock);
    const res = await call();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });
  it('rejects a cross-origin public redirect instead of forwarding credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'https://other.example/users/auth' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const res = await call();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops redirect loops', async () => {
    const fetchMock = vi.fn().mockImplementation(
      async () =>
        new Response(null, {
          status: 307,
          headers: { location: '/users/auth' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const res = await call();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
  it('allows same-host HTTP to HTTPS upgrades', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 301,
          headers: { location: 'https://sync.example.com/users/auth' },
        }),
      )
      .mockResolvedValueOnce(new Response('{"ok":true}'));
    vi.stubGlobal('fetch', fetchMock);
    const res = await call('/users/auth', 'http://sync.example.com');
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://sync.example.com/users/auth',
      expect.objectContaining({ redirect: 'manual' }),
    );
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });
  it.each([
    301, 302, 303, 307, 308,
  ])('uses fetch-compatible POST semantics for %s', async (status) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status, headers: { location: '/users/create/' } }),
      )
      .mockResolvedValueOnce(new Response('{"ok":true}'));
    vi.stubGlobal('fetch', fetchMock);
    const body = { username: 'test-reader' };
    await call('/users/create', 'https://sync.example.com', { method: 'POST', body });
    const preservesBody = status === 307 || status === 308;
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://sync.example.com/users/create/',
      expect.objectContaining({
        method: preservesBody ? 'POST' : 'GET',
        body: preservesBody ? JSON.stringify(body) : null,
        redirect: 'manual',
      }),
    );
  });
});
