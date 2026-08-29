import { NextRequest, NextResponse } from 'next/server';

const NOTION_UPSTREAM = 'https://api.notion.com/v1';
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PATCH']);

interface RouteParams {
  params: Promise<{ path: string[] }>;
}

// Notion id / database id / block id are UUIDs (hex + dashes) or bare 32-hex.
// Restricting each path segment to that alphabet keeps the proxy from being
// used as a general-purpose URL forwarder while still covering every endpoint
// the client calls (`users/me`, `databases/{id}/query`, `blocks/{id}/children`,
// `pages`). The upstream host is fixed, so there is no SSRF surface.
const isSafeSegment = (segment: string): boolean => /^[a-zA-Z0-9_-]+$/.test(segment);

async function forward(request: NextRequest, pathSegments: string[]) {
  const method = request.method;
  if (!ALLOWED_METHODS.has(method)) {
    return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
  }
  if (pathSegments.length === 0 || !pathSegments.every(isSafeSegment)) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  const authorization = request.headers.get('authorization');
  if (!authorization) {
    return NextResponse.json({ error: 'Missing authorization header' }, { status: 401 });
  }
  const notionVersion = request.headers.get('notion-version') ?? '2022-06-28';

  const headers: Record<string, string> = {
    authorization,
    'notion-version': notionVersion,
  };

  let body: string | undefined;
  if (method !== 'GET') {
    body = await request.text();
    headers['content-type'] = 'application/json';
  }

  try {
    const url = `${NOTION_UPSTREAM}/${pathSegments.join('/')}`;
    const res = await fetch(url, { method, headers, body });
    const text = await res.text();
    // Pass the upstream body through verbatim so the client's error handling
    // (which reads `message` / `detail` from Notion's JSON) keeps working.
    return new NextResponse(text, {
      status: res.status,
      headers: {
        'content-type': res.headers.get('content-type') ?? 'application/json',
      },
    });
  } catch (error) {
    console.error('[Notion Proxy] fetch error:', error);
    return NextResponse.json({ error: 'Failed to reach Notion API' }, { status: 502 });
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
