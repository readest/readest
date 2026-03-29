import { NextRequest, NextResponse } from 'next/server';

const HARDCOVER_ENDPOINT = 'https://api.hardcover.app/v1/graphql';

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
    const query =
      body && typeof body === 'object' && 'query' in body ? String((body as { query?: unknown }).query) : '';
    console.log('[Hardcover Proxy] forwarding request', {
      hasAuthorization: !!authorization,
      operationPreview: query.split('\n').find((line) => line.trim()) || query.slice(0, 80),
    });

    const res = await fetch(HARDCOVER_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization,
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    console.log('[Hardcover Proxy] response status', res.status);
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error('[Hardcover Proxy] fetch error:', error);
    return NextResponse.json({ error: 'Failed to reach Hardcover API' }, { status: 502 });
  }
}
