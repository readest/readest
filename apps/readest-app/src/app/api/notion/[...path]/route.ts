import { NextRequest, NextResponse } from 'next/server';
import { NOTION_API_VERSION } from '@/services/constants';
import { validateUserAndToken } from '@/utils/access';

const NOTION_UPSTREAM = 'https://api.notion.com/v1';
/**
 * The caller's Notion integration secret. It travels in its own header so
 * `authorization` can carry the Readest JWT that actually authenticates the
 * caller, matching the azure-translate / yandex-translate proxies.
 */
const NOTION_TOKEN_HEADER = 'x-notion-token';
const MAX_REQUEST_BODY_BYTES = 500 * 1024;
const UPSTREAM_TIMEOUT_MS = 15_000;

interface RouteParams {
  params: Promise<{ path: string[] }>;
}

const isId = (segment: string | undefined): segment is string =>
  !!segment && /^[a-zA-Z0-9_-]+$/.test(segment);

const isAllowedOperation = (method: string, path: string[]): boolean => {
  if (method === 'GET' && path.length === 2 && path[0] === 'users' && path[1] === 'me') {
    return true;
  }
  if (
    method === 'GET' &&
    path.length === 2 &&
    (path[0] === 'data_sources' || path[0] === 'databases' || path[0] === 'pages') &&
    isId(path[1])
  ) {
    return true;
  }
  if (
    method === 'POST' &&
    path.length === 3 &&
    path[0] === 'data_sources' &&
    isId(path[1]) &&
    path[2] === 'query'
  ) {
    return true;
  }
  if (
    method === 'GET' &&
    path.length === 3 &&
    path[0] === 'blocks' &&
    isId(path[1]) &&
    path[2] === 'children'
  ) {
    return true;
  }
  if (method === 'POST' && path.length === 1 && path[0] === 'pages') return true;
  if (method === 'PATCH' && path.length === 2 && path[0] === 'pages' && isId(path[1])) {
    return true;
  }
  if (
    method === 'PATCH' &&
    path.length === 3 &&
    path[0] === 'blocks' &&
    isId(path[1]) &&
    path[2] === 'children'
  ) {
    return true;
  }
  return method === 'DELETE' && path.length === 2 && path[0] === 'blocks' && isId(path[1]);
};

const isSameOriginBrowserRequest = (request: NextRequest): boolean => {
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  return origin === request.nextUrl.origin || fetchSite === 'same-origin';
};

type BodyResult = { ok: true; body: string } | { ok: false };

const readBoundedBody = async (request: NextRequest): Promise<BodyResult> => {
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BODY_BYTES) {
    return { ok: false };
  }
  if (!request.body) return { ok: true, body: '' };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_REQUEST_BODY_BYTES) {
      await reader.cancel();
      return { ok: false };
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, body: new TextDecoder().decode(bytes) };
};

const upstreamUrl = (request: NextRequest, path: string[]): string => {
  const url = new URL(`${NOTION_UPSTREAM}/${path.join('/')}`);
  if (request.method === 'GET' && path[0] === 'blocks' && path[2] === 'children') {
    const pageSize = request.nextUrl.searchParams.get('page_size');
    const cursor = request.nextUrl.searchParams.get('start_cursor');
    if (pageSize && /^\d{1,3}$/.test(pageSize) && Number(pageSize) <= 100) {
      url.searchParams.set('page_size', pageSize);
    }
    if (cursor && new TextEncoder().encode(cursor).byteLength <= 512) {
      url.searchParams.set('start_cursor', cursor);
    }
  }
  return url.toString();
};

async function forward(request: NextRequest, path: string[]) {
  if (!isAllowedOperation(request.method, path)) {
    return NextResponse.json({ error: 'Notion operation not found' }, { status: 404 });
  }
  if (!isSameOriginBrowserRequest(request)) {
    return NextResponse.json({ error: 'Cross-origin request denied' }, { status: 403 });
  }

  // Authenticate the caller, not the credential they hand us. Without this the
  // route is an anonymous relay for the whole Notion API on Readest's budget:
  // a format check on a third-party secret proves nothing about who is calling.
  const { user, token } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user || !token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 403 });
  }

  const notionToken = request.headers.get(NOTION_TOKEN_HEADER) ?? '';
  if (!/^Bearer\s+(?:secret_|ntn_)[a-zA-Z0-9_-]+$/.test(notionToken)) {
    return NextResponse.json({ error: 'Invalid Notion token' }, { status: 401 });
  }

  let body: string | undefined;
  if (request.method === 'POST' || request.method === 'PATCH') {
    const result = await readBoundedBody(request);
    if (!result.ok) {
      return NextResponse.json({ error: 'Request body too large' }, { status: 413 });
    }
    body = result.body;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  const abort = () => controller.abort();
  request.signal.addEventListener('abort', abort, { once: true });

  try {
    const response = await fetch(upstreamUrl(request, path), {
      method: request.method,
      headers: {
        authorization: notionToken,
        'notion-version': NOTION_API_VERSION,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body,
      signal: controller.signal,
    });
    const headers = new Headers({
      'content-type': response.headers.get('content-type') ?? 'application/json',
    });
    const retryAfter = response.headers.get('retry-after');
    if (retryAfter) headers.set('retry-after', retryAfter);
    return new NextResponse(response.body, { status: response.status, headers });
  } catch (error) {
    console.error('[Notion Proxy] fetch error:', error);
    return NextResponse.json({ error: 'Failed to reach Notion API' }, { status: 502 });
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener('abort', abort);
  }
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { path } = await params;
  return forward(request, path);
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { path } = await params;
  return forward(request, path);
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { path } = await params;
  return forward(request, path);
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { path } = await params;
  return forward(request, path);
}
