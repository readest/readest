// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  admin: { email: 'admin@example.com' } as { email: string } | null,
  stub: {
    adminSnapshot: vi.fn(),
    adminCreateWorker: vi.fn(),
    adminRemoveWorker: vi.fn(),
    adminSetPaused: vi.fn(),
  },
}));

vi.mock('../../../workers/voice-admin/src/access', () => ({ verifyAccess: async () => m.admin }));

import worker, { type Env } from '../../../workers/voice-admin/src/index';

const ORIGIN = 'https://voice-admin.readest.com';
const env = {
  ACCESS_TEAM_DOMAIN: 'https://readest.cloudflareaccess.com',
  ACCESS_AUD: 'aud',
  TTS_DISPATCHER: { idFromName: (name: string) => name, get: () => m.stub },
} as unknown as Env;

const call = (path: string, init: RequestInit = {}) =>
  worker.fetch(new Request(`${ORIGIN}${path}`, init), env);

const send = (method: string, path: string, body?: unknown, origin: string | null = ORIGIN) =>
  call(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(origin ? { Origin: origin } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  m.admin = { email: 'admin@example.com' };
  for (const fn of Object.values(m.stub)) fn.mockReset();
});

describe('dashboard worker', () => {
  it('refuses every path without an Access sign-in', async () => {
    m.admin = null;
    for (const path of ['/', '/app.js', '/api/state']) {
      expect((await call(path)).status).toBe(403);
    }
    expect((await send('POST', '/api/workers', { name: 'x' })).status).toBe(403);
    expect(m.stub.adminCreateWorker).not.toHaveBeenCalled();
  });

  it('serves the page and its script, never cached or framed', async () => {
    const page = await call('/');
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(page.headers.get('cache-control')).toBe('no-store');
    expect(page.headers.get('x-frame-options')).toBe('DENY');
    expect(page.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(await page.text()).toContain('<script src="/app.js"');
    const script = await call('/app.js');
    expect(script.headers.get('content-type')).toContain('javascript');
  });

  it('reports the dispatcher state with the signed-in admin', async () => {
    m.stub.adminSnapshot.mockResolvedValueOnce({ now: 1, workers: [] });
    const res = await call('/api/state');
    expect(await res.json()).toEqual({ now: 1, workers: [], admin: 'admin@example.com' });
  });

  it('adds a worker and returns its token once', async () => {
    m.stub.adminCreateWorker.mockResolvedValueOnce({ ok: true, token: 't0k' });
    const res = await send('POST', '/api/workers', { name: 'gpu-2' });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ name: 'gpu-2', token: 't0k' });
    expect(m.stub.adminCreateWorker).toHaveBeenCalledWith('gpu-2');

    m.stub.adminCreateWorker.mockResolvedValueOnce({ ok: false, error: 'NAME_TAKEN' });
    const taken = await send('POST', '/api/workers', { name: 'gpu-2' });
    expect(taken.status).toBe(400);
    expect(await taken.json()).toEqual({ error: 'NAME_TAKEN' });
  });

  it('pauses, resumes and removes workers', async () => {
    m.stub.adminSetPaused.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect((await send('POST', '/api/workers/gpu-2/pause', { paused: true })).status).toBe(200);
    expect(m.stub.adminSetPaused).toHaveBeenCalledWith('gpu-2', true);
    expect((await send('POST', '/api/workers/nobody/pause', { paused: false })).status).toBe(404);

    m.stub.adminRemoveWorker.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect((await send('DELETE', '/api/workers/gpu-2')).status).toBe(204);
    expect(m.stub.adminRemoveWorker).toHaveBeenCalledWith('gpu-2');
    expect((await send('DELETE', '/api/workers/gpu-2')).status).toBe(404);
  });

  it('refuses changes from another origin or without one', async () => {
    expect((await send('POST', '/api/workers', { name: 'x' }, 'https://evil.example')).status).toBe(
      403,
    );
    expect((await send('DELETE', '/api/workers/x', undefined, null)).status).toBe(403);
    expect(m.stub.adminCreateWorker).not.toHaveBeenCalled();
    expect(m.stub.adminRemoveWorker).not.toHaveBeenCalled();
  });

  it('rejects malformed bodies and unknown paths', async () => {
    expect((await send('POST', '/api/workers', { name: 3 })).status).toBe(400);
    expect((await send('POST', '/api/workers/x/pause', { paused: 'yes' })).status).toBe(400);
    expect((await call('/nope')).status).toBe(404);
  });
});
