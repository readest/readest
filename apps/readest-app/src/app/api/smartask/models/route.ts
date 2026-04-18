import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');
  const auth = request.nextUrl.searchParams.get('auth');

  if (!url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  try {
    new URL(url);
  } catch {
    return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
  }

  try {
    const headers: HeadersInit = { Accept: 'application/json' };
    if (auth) {
      headers['Authorization'] = auth;
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
      return NextResponse.json(
        { error: `Upstream error ${response.status}` },
        { status: response.status },
      );
    }

    const data: unknown = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch models' },
      { status: 500 },
    );
  }
}
