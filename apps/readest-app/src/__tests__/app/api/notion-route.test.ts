import { beforeEach, describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { DELETE, GET, PATCH, POST } from '@/app/api/notion/[...path]/route';
import { NOTION_API_VERSION } from '@/services/constants';

const params = (path: string[]) => ({ params: Promise.resolve({ path }) });
const sameOriginHeaders = {
  origin: 'https://web.readest.com',
  authorization: 'Bearer secret_test',
};

describe('Notion proxy', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  test('only forwards the exact Notion operations used by the client', async () => {
    const request = new NextRequest('https://web.readest.com/api/notion/databases/id/query', {
      method: 'POST',
      headers: sameOriginHeaders,
      body: '{}',
    });

    const response = await POST(request, params(['databases', 'id', 'query']));

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('requires a same-origin browser request and a Bearer token', async () => {
    const crossOrigin = new NextRequest('https://web.readest.com/api/notion/users/me', {
      headers: { origin: 'https://evil.example', authorization: 'Bearer secret_test' },
    });
    const badAuth = new NextRequest('https://web.readest.com/api/notion/users/me', {
      headers: { origin: 'https://web.readest.com', authorization: 'Basic nope' },
    });
    const fakeBearer = new NextRequest('https://web.readest.com/api/notion/users/me', {
      headers: { origin: 'https://web.readest.com', authorization: 'Bearer not-a-notion-token' },
    });

    expect((await GET(crossOrigin, params(['users', 'me']))).status).toBe(403);
    expect((await GET(badAuth, params(['users', 'me']))).status).toBe(401);
    expect((await GET(fakeBearer, params(['users', 'me']))).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('rejects oversized bodies before buffering them', async () => {
    const request = new NextRequest('https://web.readest.com/api/notion/pages', {
      method: 'POST',
      headers: { ...sameOriginHeaders, 'content-length': String(500 * 1024 + 1) },
      body: '{}',
    });

    const response = await POST(request, params(['pages']));

    expect(response.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('also bounds chunked bodies without a Content-Length header', async () => {
    const request = new NextRequest('https://web.readest.com/api/notion/pages', {
      method: 'POST',
      headers: sameOriginHeaders,
      body: 'x'.repeat(500 * 1024 + 1),
    });

    const response = await POST(request, params(['pages']));

    expect(response.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('drops oversized pagination cursors before forwarding', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    const request = new NextRequest(
      `https://web.readest.com/api/notion/blocks/page-id/children?start_cursor=${'x'.repeat(513)}`,
      { headers: sameOriginHeaders },
    );

    const response = await GET(request, params(['blocks', 'page-id', 'children']));

    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.notion.com/v1/blocks/page-id/children');
  });

  test('pins the API version and streams upstream metadata needed for retries', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: 'slow down' }), {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': '2' },
      }),
    );
    const request = new NextRequest('https://web.readest.com/api/notion/blocks/block-id/children', {
      method: 'PATCH',
      headers: { ...sameOriginHeaders, 'notion-version': '2022-06-28' },
      body: JSON.stringify({ children: [] }),
    });

    const response = await PATCH(request, params(['blocks', 'block-id', 'children']));

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('2');
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init.headers as Record<string, string>)['notion-version']).toBe(NOTION_API_VERSION);
  });

  test('allows page discovery, creation, block deletion, and paginated child lookup', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    const create = new NextRequest('https://web.readest.com/api/notion/pages', {
      method: 'POST',
      headers: sameOriginHeaders,
      body: '{}',
    });
    const remove = new NextRequest('https://web.readest.com/api/notion/blocks/block-id', {
      method: 'DELETE',
      headers: sameOriginHeaders,
    });
    const lookup = new NextRequest(
      'https://web.readest.com/api/notion/blocks/page-id/children?page_size=100&start_cursor=next',
      { headers: sameOriginHeaders },
    );
    const query = new NextRequest(
      'https://web.readest.com/api/notion/data_sources/source-id/query',
      {
        method: 'POST',
        headers: sameOriginHeaders,
        body: '{}',
      },
    );
    const page = new NextRequest('https://web.readest.com/api/notion/pages/page-id', {
      headers: sameOriginHeaders,
    });
    expect((await POST(query, params(['data_sources', 'source-id', 'query']))).status).toBe(200);
    expect((await GET(page, params(['pages', 'page-id']))).status).toBe(200);
    expect((await POST(create, params(['pages']))).status).toBe(200);
    expect((await DELETE(remove, params(['blocks', 'block-id']))).status).toBe(200);
    expect((await GET(lookup, params(['blocks', 'page-id', 'children']))).status).toBe(200);
    expect(fetchMock.mock.calls[4]![0]).toBe(
      'https://api.notion.com/v1/blocks/page-id/children?page_size=100&start_cursor=next',
    );
  });
});
