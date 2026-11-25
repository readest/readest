// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthSessionRow } from '@/utils/syncDevices';

const h = vi.hoisted(() => ({
  claims: null as Record<string, unknown> | null,
  sessions: [] as AuthSessionRow[],
  rpcCalls: [] as [string, Record<string, unknown>][],
  listError: null as { message: string } | null,
  // Fail every list after this many, as a flaky connection would.
  listsBeforeError: Infinity,
}));

const jwt = (claims: Record<string, unknown>) =>
  `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

vi.mock('@/utils/access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/access')>()),
  validateUserAndToken: async () =>
    h.claims ? { user: { id: 'u1' }, token: jwt(h.claims) } : { user: null, token: null },
}));

vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      h.rpcCalls.push([fn, args]);
      if (fn === 'list_user_sessions') {
        if (h.listsBeforeError-- <= 0) return { data: null, error: { message: 'timeout' } };
        return h.listError ? { data: null, error: h.listError } : { data: h.sessions, error: null };
      }
      const ids = args['p_session_ids'] as string[];
      h.sessions = h.sessions.filter((s) => !ids.includes(s.id));
      return { data: ids.length, error: null };
    },
  }),
}));

import { DELETE, GET } from '@/app/api/auth/sessions/route';

const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const APP_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36';
const KOREADER = 'KOReader/v2025.08 (Kindle Paperwhite 5; Linux; arm) LuaSocket/3.0.0';
const APP_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

const row = (id: string, ua: string | null, day: number): AuthSessionRow => ({
  id,
  user_agent: ua,
  created_at: `2026-01-0${day}T00:00:00Z`,
  last_active_at: `2026-01-0${day}T12:00:00Z`,
});

const req = (method: string, body?: unknown, userAgent = APP_IPHONE) =>
  new Request('http://localhost/api/auth/sessions', {
    method,
    headers: { authorization: 'Bearer t', 'user-agent': userAgent },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  h.claims = { plan: 'free', session_id: 'new' };
  h.sessions = [
    row('a', CHROME_MAC, 1),
    row('b', APP_ANDROID, 2),
    row('c', KOREADER, 3),
    // GoTrue made the new session on the server, so it has no agent yet.
    row('new', null, 4),
  ];
  h.rpcCalls = [];
  h.listError = null;
  h.listsBeforeError = Infinity;
});

describe('GET /api/auth/sessions', () => {
  it('needs a signed-in user', async () => {
    h.claims = null;
    expect((await GET(req('GET'))).status).toBe(403);
  });

  it("blocks a Free plan's fourth device and lists the other three", async () => {
    const res = await GET(req('GET'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.limit).toBe(3);
    expect(body.blocked).toBe(true);
    expect(h.rpcCalls).toEqual([['list_user_sessions', { p_user_id: 'u1' }]]);
    // This device is named from the request, since its session has no agent.
    expect(body.devices).toEqual([
      expect.objectContaining({ client: 'Readest', os: 'iPhone', current: true }),
      expect.objectContaining({ client: 'KOReader', os: 'Kindle Paperwhite 5', current: false }),
      expect.objectContaining({ client: 'Readest', os: 'Pixel 7', current: false }),
      expect.objectContaining({ client: 'Chrome', os: 'macOS', current: false }),
    ]);
    // Session ids stay on the server.
    expect(JSON.stringify(body)).not.toContain('sessionIds');
  });

  it('never blocks a paid plan', async () => {
    h.claims = { plan: 'plus', session_id: 'new' };
    const body = await (await GET(req('GET'))).json();
    expect(body).toMatchObject({ limit: null, blocked: false });
    expect(body.devices).toHaveLength(4);
  });

  it('answers 500 when the sessions cannot be read', async () => {
    h.listError = { message: 'function list_user_sessions does not exist' };
    expect((await GET(req('GET'))).status).toBe(500);
  });
});

describe('DELETE /api/auth/sessions', () => {
  const deviceId = async (client: string) => {
    const body = await (await GET(req('GET'))).json();
    return body.devices.find((d: { client: string }) => d.client === client).id as string;
  };

  it('signs out every session of another device, then lets this one in', async () => {
    h.sessions.push(row('a2', CHROME_MAC.replace('131', '146'), 5));
    const id = await deviceId('Chrome');
    h.rpcCalls = [];

    const res = await DELETE(req('DELETE', { id }));
    expect(res.status).toBe(200);
    expect(h.rpcCalls).toContainEqual([
      'delete_user_sessions',
      { p_user_id: 'u1', p_session_ids: ['a', 'a2'] },
    ]);
    const body = await res.json();
    expect(body.blocked).toBe(false);
    expect(body.devices.map((d: { client: string }) => d.client)).not.toContain('Chrome');
  });

  // The sign-out has happened by then: a 500 would leave the device listed,
  // and asking again would only find it gone.
  it('answers with the devices left without reading the sessions again', async () => {
    const id = await deviceId('KOReader');
    h.rpcCalls = [];
    h.listsBeforeError = 1;

    const res = await DELETE(req('DELETE', { id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.blocked).toBe(false);
    expect(body.devices.map((d: { client: string }) => d.client)).toEqual([
      'Readest',
      'Readest',
      'Chrome',
    ]);
    expect(h.rpcCalls.map(([fn]) => fn)).toEqual(['list_user_sessions', 'delete_user_sessions']);
  });

  it('refuses to sign out this device', async () => {
    const id = await deviceId('Readest');
    h.rpcCalls = [];
    expect((await DELETE(req('DELETE', { id }))).status).toBe(404);
    expect(h.rpcCalls.map(([fn]) => fn)).not.toContain('delete_user_sessions');
  });

  it('answers 404 for a device that is not signed in', async () => {
    expect((await DELETE(req('DELETE', { id: 'nope' }))).status).toBe(404);
    expect((await DELETE(req('DELETE', {}))).status).toBe(400);
  });
});
