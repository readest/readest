// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../../../workers/auth-proxy/src/index';

const SUPABASE_URL = 'https://project.supabase.co';
const PROXY = 'https://auth-cf.readest.com';
const env = { SUPABASE_URL, SUPABASE_SECRET_KEY: 'sb_secret_test' };

const upstreamFetch = vi.fn<typeof fetch>();

const post = (path: string, init: RequestInit = {}) =>
  new Request(`${PROXY}${path}`, {
    method: 'POST',
    body: '{"email":"a@b.c","password":"pw"}',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      apikey: 'anon-key',
      Authorization: 'Bearer anon-key',
      'X-Client-Info': 'supabase-js/2',
      'X-Supabase-Api-Version': '2024-01-01',
      'CF-Connecting-IP': '203.0.113.7',
      ...init.headers,
    },
  });

const forwarded = () => {
  const [url, init] = upstreamFetch.mock.calls[0]!;
  return { url: String(url), init: init!, headers: new Headers(init!.headers) };
};

beforeEach(() => {
  upstreamFetch.mockReset();
  upstreamFetch.mockResolvedValue(
    new Response('{"access_token":"t"}', {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': 'https://web.readest.com',
        'Access-Control-Allow-Credentials': 'true',
        'X-Supabase-Api-Version': '2024-01-01',
      },
    }),
  );
  vi.stubGlobal('fetch', upstreamFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('auth proxy worker', () => {
  describe.each(['password', 'refresh_token'])('%s grant', (grant) => {
    const path = `/auth/v1/token?grant_type=${grant}`;

    it('forwards to Supabase with the body intact', async () => {
      const res = await worker.fetch(post(path), env);

      expect(res.status).toBe(200);
      expect(await res.text()).toBe('{"access_token":"t"}');
      const { url, init, headers } = forwarded();
      expect(url).toBe(`${SUPABASE_URL}${path}`);
      expect(init.method).toBe('POST');
      expect(await new Response(init.body).text()).toBe('{"email":"a@b.c","password":"pw"}');
      expect(headers.get('content-type')).toBe('application/json');
      expect(headers.get('x-client-info')).toBe('supabase-js/2');
      expect(headers.get('x-supabase-api-version')).toBe('2024-01-01');
    });

    it('rate limits on the reader IP, not the shared Worker IP', async () => {
      await worker.fetch(post(path), env);

      const { headers } = forwarded();
      expect(headers.get('apikey')).toBe('sb_secret_test');
      expect(headers.get('sb-forwarded-for')).toBe('203.0.113.7');
    });

    it('ignores a forwarded IP and Authorization sent by the client', async () => {
      await worker.fetch(post(path, { headers: { 'Sb-Forwarded-For': '198.51.100.1' } }), env);

      const { headers } = forwarded();
      expect(headers.get('sb-forwarded-for')).toBe('203.0.113.7');
      expect(headers.get('authorization')).toBeNull();
    });
  });

  it('signs out with the reader JWT and never the secret key', async () => {
    const path = '/auth/v1/logout?scope=local';
    await worker.fetch(post(path, { headers: { Authorization: 'Bearer user-jwt' } }), env);

    const { url, headers } = forwarded();
    expect(url).toBe(`${SUPABASE_URL}${path}`);
    expect(headers.get('authorization')).toBe('Bearer user-jwt');
    expect(headers.get('apikey')).toBe('anon-key');
  });

  it.each([
    ['POST', '/auth/v1/admin/users'],
    ['GET', '/auth/v1/admin/users'],
    ['POST', '/auth/v1/token?grant_type=id_token'],
    ['POST', '/auth/v1/token?grant_type=pkce'],
    ['POST', '/auth/v1/token'],
    ['GET', '/auth/v1/token?grant_type=password'],
    ['GET', '/auth/v1/user'],
    ['POST', '/auth/v1/signup'],
    ['POST', '/auth/v1/token/?grant_type=password'],
    ['POST', '/auth/v1/x/../admin/users'],
    ['POST', '/rest/v1/plans'],
    ['GET', '/'],
  ])('does not forward %s %s', async (method, path) => {
    const res = await worker.fetch(new Request(`${PROXY}${path}`, { method }), env);

    expect(res.status).toBe(404);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it('answers the CORS preflight without calling Supabase', async () => {
    const res = await worker.fetch(
      new Request(`${PROXY}/auth/v1/token?grant_type=password`, { method: 'OPTIONS' }),
      env,
    );

    expect(res.ok).toBe(true);
    expect(upstreamFetch).not.toHaveBeenCalled();
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
    const allowed = res.headers.get('access-control-allow-headers')!.toLowerCase();
    for (const header of [
      'apikey',
      'authorization',
      'content-type',
      'x-client-info',
      'x-supabase-api-version',
      'x-retry-count',
    ]) {
      expect(allowed).toContain(header);
    }
  });

  it('passes Supabase errors through and lets the client read them', async () => {
    upstreamFetch.mockResolvedValue(
      new Response('{"error_code":"invalid_credentials"}', {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'X-Supabase-Api-Version': '2024-01-01' },
      }),
    );

    const res = await worker.fetch(post('/auth/v1/token?grant_type=password'), env);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error_code: 'invalid_credentials' });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
    expect(res.headers.get('access-control-expose-headers')).toContain('X-Supabase-Api-Version');
    expect(res.headers.get('x-supabase-api-version')).toBe('2024-01-01');
  });

  // auth-js ends the session on any refresh failure it can't retry, which is
  // everything but 502/503/504-style statuses. A 4xx or an HTML 500 from this
  // Worker would sign readers out.
  it('fails with a retryable status when the secret key is missing', async () => {
    const res = await worker.fetch(post('/auth/v1/token?grant_type=refresh_token'), {
      SUPABASE_URL,
      SUPABASE_SECRET_KEY: '',
    });

    expect(res.status).toBe(503);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it('fails with a retryable status when Supabase is unreachable', async () => {
    upstreamFetch.mockRejectedValue(new TypeError('network'));

    const res = await worker.fetch(post('/auth/v1/token?grant_type=refresh_token'), env);

    expect(res.status).toBe(502);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});
