import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: (...args: unknown[]) => fetchMock(...args) }));

import { testServer } from '@/services/serverConnection';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const route = (handlers: Record<string, () => Response | Promise<Response>>) => {
  fetchMock.mockImplementation(async (url: string) => {
    const handler = handlers[url];
    if (!handler) throw new Error(`unexpected fetch ${url}`);
    return handler();
  });
};

const CONFIG = {
  supabaseUrl: 'https://books.example.com',
  supabaseAnonKey: 'anon-key',
  apiBaseUrl: 'https://books.example.com',
  selfHosted: true,
};

beforeEach(() => {
  fetchMock.mockReset();
});

describe('testServer', () => {
  it('returns the fetched config when every check passes', async () => {
    route({
      'https://books.example.com/api/runtime-config': () => json(CONFIG),
      'https://books.example.com/auth/v1/health': () => json({ name: 'GoTrue' }),
    });
    expect(await testServer('https://books.example.com')).toEqual({
      ok: true,
      config: CONFIG,
      authHost: 'books.example.com',
      authHostDiffers: false,
    });
  });

  it('discloses an auth host that differs from the server', async () => {
    route({
      'https://books.example.com/api/runtime-config': () =>
        json({ ...CONFIG, supabaseUrl: 'https://auth.example.com' }),
      'https://auth.example.com/auth/v1/health': () => json({}),
    });
    const result = await testServer('https://books.example.com');
    expect(result).toMatchObject({ ok: true, authHost: 'auth.example.com', authHostDiffers: true });
  });

  it('applies overrides before checking auth', async () => {
    route({
      'https://books.example.com/api/runtime-config': () => json({ apiBaseUrl: CONFIG.apiBaseUrl }),
      'https://auth.example.com/auth/v1/health': () => json({}),
    });
    const result = await testServer('https://books.example.com', {
      supabaseUrl: 'https://auth.example.com',
      supabaseAnonKey: 'override-key',
    });
    expect(result).toMatchObject({ ok: true, authHost: 'auth.example.com' });
  });

  it('reports a server without the endpoint as outdated', async () => {
    route({ 'https://books.example.com/api/runtime-config': () => json({}, 404) });
    expect(await testServer('https://books.example.com')).toEqual({ ok: false, error: 'outdated' });
  });

  it('reports a server that disallows app connections as disabled', async () => {
    route({ 'https://books.example.com/api/runtime-config': () => json({}, 403) });
    expect(await testServer('https://books.example.com')).toEqual({ ok: false, error: 'disabled' });
  });

  it('reports other HTTP errors as unreachable', async () => {
    route({ 'https://books.example.com/api/runtime-config': () => json({}, 502) });
    expect(await testServer('https://books.example.com')).toEqual({
      ok: false,
      error: 'unreachable',
    });
  });

  it('reports a network failure as unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('connection refused'));
    expect(await testServer('https://books.example.com')).toEqual({
      ok: false,
      error: 'unreachable',
    });
  });

  it('reports a non-JSON response as not a Readest server', async () => {
    route({
      'https://books.example.com/api/runtime-config': () => new Response('<html></html>'),
    });
    expect(await testServer('https://books.example.com')).toEqual({
      ok: false,
      error: 'not-readest',
    });
  });

  it('reports a config with unknown keys as not a Readest server', async () => {
    route({
      'https://books.example.com/api/runtime-config': () => json({ ...CONFIG, other: 1 }),
    });
    expect(await testServer('https://books.example.com')).toEqual({
      ok: false,
      error: 'not-readest',
    });
  });

  it('reports a config without Supabase credentials as incomplete', async () => {
    route({
      'https://books.example.com/api/runtime-config': () => json({ apiBaseUrl: CONFIG.apiBaseUrl }),
    });
    expect(await testServer('https://books.example.com')).toEqual({
      ok: false,
      error: 'incomplete',
    });
  });

  it('reports an unreachable auth service with its host', async () => {
    route({
      'https://books.example.com/api/runtime-config': () =>
        json({ ...CONFIG, supabaseUrl: 'https://auth.example.com' }),
      'https://auth.example.com/auth/v1/health': () => json({}, 503),
    });
    expect(await testServer('https://books.example.com')).toEqual({
      ok: false,
      error: 'auth-unreachable',
      authHost: 'auth.example.com',
    });
  });
});
