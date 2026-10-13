import { NextRequest, NextResponse } from 'next/server';

const HARDCOVER_ENDPOINT = 'https://api.hardcover.app/v1/graphql';
const FORWARDED_HEADERS = ['Retry-After', 'RateLimit', 'RateLimit-Policy'];

export async function POST(request: NextRequest) {
  const authorization = request.headers.get('authorization');
  if (!authorization) {
    return NextResponse.json({ error: 'Missing authorization header' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    console.log('[Hardcover Proxy] forwarding request');

    const res = await fetch(HARDCOVER_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization,
      },
      body: JSON.stringify(body),
    });

    // Error bodies (e.g. a 429) may not be JSON.
    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
    console.log('[Hardcover Proxy] response status', res.status);

    const headers = new Headers();
    for (const name of FORWARDED_HEADERS) {
      const value = res.headers.get(name);
      if (value) headers.set(name, value);
    }
    return NextResponse.json(data, { status: res.status, headers });
  } catch (error) {
    console.error('[Hardcover Proxy] fetch error:', error);
    return NextResponse.json({ error: 'Failed to reach Hardcover API' }, { status: 502 });
  }
}
