import { beforeEach, describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { DELETE, GET, PATCH, POST } from '@/app/api/notion/[...path]/route';
import { NOTION_API_VERSION } from '@/services/constants';

const READEST_JWT = 'Bearer readest-jwt';
const NOTION_SECRET = 'Bearer secret_test';

vi.mock('@/utils/access', () => ({
  validateUserAndToken: vi.fn(async (header: string | null | undefined) =>
    header === READEST_JWT ? { user: { id: 'user-1' }, token: 'readest-jwt' } : {},
  ),
}));

const params = (path: string[]) => ({ params: Promise.resolve({ path }) });
const sameOriginHeaders = {
  origin: 'https://web.readest.com',
  authorization: READEST_JWT,
  'x-notion-token': NOTION_SECRET,
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

  test('rejects a path segment that is not a plain Notion id', async () => {
    const traversal = new NextRequest('https://web.readest.com/api/notion/pages/..', {
      headers: sameOriginHeaders,
    });

    expect((await GET(traversal, params(['pages', '..']))).status).toBe(404);
    expect((await GET(traversal, params(['pages', '']))).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('requires an authenticated Readest user, not just a Notion-shaped token', async () => {
    const anonymous = new NextRequest('https://web.readest.com/api/notion/users/me', {
      headers: { origin: 'https://web.readest.com', 'x-notion-token': NOTION_SECRET },
    });
    // A well-formed Notion secret in `authorization` must not stand in for the
    // Readest JWT: that was exactly the pre-auth relay hole.
    const notionSecretAsCallerAuth = new NextRequest(
      'https://web.readest.com/api/notion/users/me',
      {
        headers: {
          origin: 'https://web.readest.com',
          authorization: NOTION_SECRET,
          'x-notion-token': NOTION_SECRET,
        },
      },
    );

    expect((await GET(anonymous, params(['users', 'me']))).status).toBe(403);
    expect((await GET(notionSecretAsCallerAuth, params(['users', 'me']))).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('requires a same-origin browser request and a well-formed Notion token', async () => {
    const crossOrigin = new NextRequest('https://web.readest.com/api/notion/users/me', {
      headers: { ...sameOriginHeaders, origin: 'https://evil.example' },
    });
    const missingNotionToken = new NextRequest('https://web.readest.com/api/notion/users/me', {
      headers: { origin: 'https://web.readest.com', authorization: READEST_JWT },
    });
    const notBearer = new NextRequest('https://web.readest.com/api/notion/users/me', {
      headers: { ...sameOriginHeaders, 'x-notion-token': 'Basic nope' },
    });
    const fakeBearer = new NextRequest('https://web.readest.com/api/notion/users/me', {
      headers: { ...sameOriginHeaders, 'x-notion-token': 'Bearer not-a-notion-token' },
    });

    expect((await GET(crossOrigin, params(['users', 'me']))).status).toBe(403);
    expect((await GET(missingNotionToken, params(['users', 'me']))).status).toBe(401);
    expect((await GET(notBearer, params(['users', 'me']))).status).toBe(401);
    expect((await GET(fakeBearer, params(['users', 'me']))).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('forwards the Notion secret upstream and never the Readest JWT', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    for (const secret of ['Bearer secret_test', 'Bearer ntn_test']) {
      fetchMock.mockClear();
      const request = new NextRequest('https://web.readest.com/api/notion/users/me', {
        headers: { ...sameOriginHeaders, 'x-notion-token': secret },
      });

      expect((await GET(request, params(['users', 'me']))).status).toBe(200);
      const headers = fetchMock.mock.calls[0]![1].headers as Record<string, string>;
      expect(headers['authorization']).toBe(secret);
      expect(headers['authorization']).not.toContain('readest-jwt');
    }
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

  test('drops an out-of-range or non-numeric page_size', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    for (const pageSize of ['999', 'abc']) {
      fetchMock.mockClear();
      const request = new NextRequest(
        `https://web.readest.com/api/notion/blocks/page-id/children?page_size=${pageSize}`,
        { headers: sameOriginHeaders },
      );

      expect((await GET(request, params(['blocks', 'page-id', 'children']))).status).toBe(200);
      expect(fetchMock.mock.calls[0]![0]).toBe('https://api.notion.com/v1/blocks/page-id/children');
    }
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

  test('reports an unreachable upstream as 502', async () => {
    fetchMock.mockRejectedValue(new TypeError('network down'));
    const request = new NextRequest('https://web.readest.com/api/notion/users/me', {
      headers: sameOriginHeaders,
    });

    expect((await GET(request, params(['users', 'me']))).status).toBe(502);
  });

  test('allows every operation the client actually issues', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    const get = (path: string) =>
      new NextRequest(`https://web.readest.com/api/notion/${path}`, { headers: sameOriginHeaders });
    const send = (path: string, method: 'POST' | 'PATCH' | 'DELETE') =>
      new NextRequest(`https://web.readest.com/api/notion/${path}`, {
        method,
        headers: sameOriginHeaders,
        ...(method === 'DELETE' ? {} : { body: '{}' }),
      });

    expect((await GET(get('users/me'), params(['users', 'me']))).status).toBe(200);
    expect((await GET(get('data_sources/id'), params(['data_sources', 'id']))).status).toBe(200);
    expect((await GET(get('databases/id'), params(['databases', 'id']))).status).toBe(200);
    expect((await GET(get('pages/page-id'), params(['pages', 'page-id']))).status).toBe(200);
    expect(
      (await POST(send('data_sources/id/query', 'POST'), params(['data_sources', 'id', 'query'])))
        .status,
    ).toBe(200);
    expect((await POST(send('pages', 'POST'), params(['pages']))).status).toBe(200);
    expect((await PATCH(send('pages/page-id', 'PATCH'), params(['pages', 'page-id']))).status).toBe(
      200,
    );
    expect(
      (
        await PATCH(
          send('blocks/block-id/children', 'PATCH'),
          params(['blocks', 'block-id', 'children']),
        )
      ).status,
    ).toBe(200);
    expect(
      (await DELETE(send('blocks/block-id', 'DELETE'), params(['blocks', 'block-id']))).status,
    ).toBe(200);

    const lookup = new NextRequest(
      'https://web.readest.com/api/notion/blocks/page-id/children?page_size=100&start_cursor=next',
      { headers: sameOriginHeaders },
    );
    expect((await GET(lookup, params(['blocks', 'page-id', 'children']))).status).toBe(200);
    expect(fetchMock.mock.calls.at(-1)![0]).toBe(
      'https://api.notion.com/v1/blocks/page-id/children?page_size=100&start_cursor=next',
    );
  });
});
