import { READEST_OPDS_USER_AGENT } from '@/services/constants';
import { NextRequest, NextResponse } from 'next/server';

async function handleRequest(request: NextRequest, method: 'GET' | 'HEAD') {
  const url = request.nextUrl.searchParams.get('url');

  if (!url) {
    return NextResponse.json(
      { error: 'Missing URL parameter. Usage: /api/rss/proxy?url=YOUR_RSS_URL' },
      { status: 400 },
    );
  }

  try {
    new URL(url);
  } catch {
    return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
  }

  try {
    console.log(`[RSS Proxy] ${method}: ${url}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    const headers: HeadersInit = {
      'User-Agent': READEST_OPDS_USER_AGENT,
      Accept: 'application/rss+xml, application/atom+xml, application/xml, */*',
    };

    const response = await fetch(url, {
      method,
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.error(`[RSS Proxy] HTTP ${response.status} for ${url}`);
      if (method === 'HEAD') {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.text();
      return new NextResponse(data, {
        status: response.status,
        headers: {
          ...Object.fromEntries(response.headers.entries()),
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    const contentType = response.headers.get('content-type') || 'application/xml';
    const data = await response.text();

    return new NextResponse(data, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=300', // Cache for 5 minutes
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  } catch (error) {
    console.error('[RSS Proxy] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Proxy request failed' },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  return handleRequest(request, 'GET');
}

export async function HEAD(request: NextRequest) {
  return handleRequest(request, 'HEAD');
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
