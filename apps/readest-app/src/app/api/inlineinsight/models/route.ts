import { NextRequest, NextResponse } from 'next/server';
import { isEndpointProtocolValid } from '@/services/inlineInsight/utils';

interface ModelsRequestBody {
  endpoint?: string;
  apiKey?: string;
}

async function fetchModels(endpoint: string | null, apiKey?: string) {
  if (!endpoint) {
    return NextResponse.json({ error: 'Missing endpoint' }, { status: 400 });
  }

  if (!isEndpointProtocolValid(endpoint)) {
    return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
  }

  try {
    const headers: HeadersInit = { Accept: 'application/json' };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(endpoint, { headers });
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

export async function POST(request: NextRequest) {
  const { endpoint, apiKey } = (await request.json()) as ModelsRequestBody;
  return fetchModels(endpoint ?? null, apiKey);
}

export async function GET(request: NextRequest) {
  const endpoint = request.nextUrl.searchParams.get('url');
  const auth = request.nextUrl.searchParams.get('auth');
  return fetchModels(endpoint, auth?.replace(/^Bearer\s+/i, ''));
}
