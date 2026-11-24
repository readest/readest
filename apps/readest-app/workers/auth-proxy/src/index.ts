// Reverse proxy for the Supabase Auth calls behind password sign-in. It holds
// a secret key, so it forwards only what's listed in isProxied: a secret key on
// an open proxy would expose the Auth admin API.
//
// Keep failures here 502/503. auth-js drops the session when a refresh fails
// with anything it can't retry, so a 4xx or an HTML 500 signs the reader out.
// Never log request bodies: they hold passwords.

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SECRET_KEY: string;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers':
    'apikey,authorization,content-type,x-client-info,x-supabase-api-version,x-retry-count',
  'Access-Control-Expose-Headers': 'X-Supabase-Api-Version',
  'Access-Control-Max-Age': '3600',
};

const isTokenGrant = ({ pathname, searchParams }: URL) =>
  pathname === '/auth/v1/token' &&
  ['password', 'refresh_token'].includes(searchParams.get('grant_type') ?? '');

const isProxied = (url: URL) => isTokenGrant(url) || url.pathname === '/auth/v1/logout';

const emptyResponse = (status: number) => new Response(null, { status, headers: CORS_HEADERS });

const forwardedHeaders = (request: Request, url: URL, env: Env) => {
  const headers = new Headers();
  for (const name of ['content-type', 'x-client-info', 'x-supabase-api-version']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (isTokenGrant(url)) {
    // The secret key is what makes Supabase honor Sb-Forwarded-For. Without
    // it, Auth rate limits all readers as this Worker's one IP.
    headers.set('apikey', env.SUPABASE_SECRET_KEY);
    headers.set('Sb-Forwarded-For', request.headers.get('CF-Connecting-IP') ?? '');
  } else {
    headers.set('apikey', request.headers.get('apikey') ?? '');
    headers.set('Authorization', request.headers.get('Authorization') ?? '');
  }
  return headers;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return emptyResponse(204);
    if (request.method !== 'POST' || !isProxied(url)) return emptyResponse(404);
    if (!env.SUPABASE_SECRET_KEY) return emptyResponse(503);

    let upstream: Response;
    try {
      upstream = await fetch(`${env.SUPABASE_URL}${url.pathname}${url.search}`, {
        method: 'POST',
        headers: forwardedHeaders(request, url, env),
        body: request.body,
      });
    } catch {
      return emptyResponse(502);
    }

    const headers = new Headers(upstream.headers);
    headers.delete('Access-Control-Allow-Credentials');
    for (const [name, value] of Object.entries(CORS_HEADERS)) headers.set(name, value);
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
