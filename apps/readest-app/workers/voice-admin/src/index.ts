// Readest Voice admin dashboard: a Worker behind Cloudflare Access that
// shows and manages the workers of the readest-web TTSDispatcher Durable
// Object (tts-dispatcher.ts), through a binding to it (script_name
// readest-web) and its admin methods (src/libs/readestVoice/admin.ts).

import type { DispatcherAdmin } from '../../../src/libs/readestVoice/admin';
import { verifyAccess } from './access';
import { APP_JS, PAGE } from './page';

// Calls through a Durable Object binding return promises.
type Remote<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<Awaited<R>>
    : never;
};
type Dispatcher = Remote<DispatcherAdmin>;

export interface Env {
  TTS_DISPATCHER: { idFromName(name: string): unknown; get(id: unknown): Dispatcher };
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
}

const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

const respond = (body: BodyInit | null, status: number, type?: string) =>
  new Response(body, {
    status,
    headers: { ...SECURITY_HEADERS, ...(type ? { 'Content-Type': type } : {}) },
  });

const json = (data: unknown, status = 200) =>
  respond(JSON.stringify(data), status, 'application/json; charset=utf-8');

const readJson = async (request: Request): Promise<Record<string, unknown>> => {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const admin = await verifyAccess(request.headers.get('Cf-Access-Jwt-Assertion'), {
      teamDomain: env.ACCESS_TEAM_DOMAIN,
      aud: env.ACCESS_AUD,
    });
    if (!admin) return json({ error: 'FORBIDDEN' }, 403);

    const url = new URL(request.url);
    // Changes must come from this page (Access cookies ride along on
    // requests from anywhere).
    if (request.method !== 'GET' && request.headers.get('Origin') !== url.origin) {
      return json({ error: 'FORBIDDEN' }, 403);
    }
    const dispatcher = env.TTS_DISPATCHER.get(env.TTS_DISPATCHER.idFromName('global'));

    if (request.method === 'GET' && url.pathname === '/') {
      return respond(PAGE, 200, 'text/html; charset=utf-8');
    }
    if (request.method === 'GET' && url.pathname === '/app.js') {
      return respond(APP_JS, 200, 'text/javascript; charset=utf-8');
    }
    if (request.method === 'GET' && url.pathname === '/api/state') {
      return json({ ...(await dispatcher.adminSnapshot()), admin: admin.email });
    }
    if (request.method === 'POST' && url.pathname === '/api/workers') {
      const { name } = await readJson(request);
      if (typeof name !== 'string') return json({ error: 'INVALID_NAME' }, 400);
      const result = await dispatcher.adminCreateWorker(name);
      return result.ok
        ? json({ name, token: result.token }, 201)
        : json({ error: result.error }, 400);
    }
    const match = url.pathname.match(/^\/api\/workers\/([a-z0-9-]+)(\/pause)?$/);
    if (match?.[2] && request.method === 'POST') {
      const { paused } = await readJson(request);
      if (typeof paused !== 'boolean') return json({ error: 'INVALID_INPUT' }, 400);
      const known = await dispatcher.adminSetPaused(match[1]!, paused);
      return known ? json({ paused }) : json({ error: 'NOT_FOUND' }, 404);
    }
    if (match && !match[2] && request.method === 'DELETE') {
      const removed = await dispatcher.adminRemoveWorker(match[1]!);
      return removed ? respond(null, 204) : json({ error: 'NOT_FOUND' }, 404);
    }
    return json({ error: 'NOT_FOUND' }, 404);
  },
};
