import { describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import handler, { isValidGrimmoryRequest } from '@/pages/api/grimmory';

vi.mock('@/utils/cors', () => ({ corsAllMethods: {}, runMiddleware: vi.fn() }));
const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('@/utils/publicFetch', () => ({ publicFetch: fetchMock }));

const call = async (serverUrl: string, path = '/api/v1/books', method = 'GET') => {
  const res = {
    status: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
    json: vi.fn(),
    send: vi.fn(),
  };
  await handler(
    { method: 'POST', body: { serverUrl, path, method } } as NextApiRequest,
    res as unknown as NextApiResponse,
  );
  return res;
};

describe('Grimmory proxy boundaries', () => {
  it.each([
    ['POST', '/api/v1/auth/login'],
    ['GET', '/api/v1/books/2/content?bookType=EPUB'],
    ['POST', '/api/v1/books/progress'],
    ['PUT', '/api/v1/annotations/7'],
    ['DELETE', '/api/v1/bookmarks/7'],
    ['GET', '/api/v1/reading-sessions/book/2?page=0&size=100'],
  ])('allows %s %s', (method, path) => {
    expect(isValidGrimmoryRequest(method, path)).toBe(true);
  });

  it.each([
    ['GET', '/api/v1/users'],
    ['DELETE', '/api/v1/books/2'],
    ['GET', '/api/v1/books/2/content?bookType=EPUB&x=1'],
    ['GET', '/api/v1/books/../users'],
    ['POST', '/api/v1/auth/login?redirect=x'],
  ])('rejects %s %s', (method, path) => {
    expect(isValidGrimmoryRequest(method, path)).toBe(false);
  });

  it.each([
    'http://192.168.1.10:6060',
    'http://localhost:6060',
    'file:///etc/passwd',
  ])('refuses %s', async (serverUrl) => {
    const res = await call(serverUrl);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it.each([
    'https://books.example.com/api/v1/books/2#',
    'https://books.example.com/api/v1/books/2?',
    'https://user:pass@books.example.com',
  ])('refuses %s, which would move the allowed path elsewhere', async (serverUrl) => {
    fetchMock.mockClear();
    const res = await call(serverUrl, '/api/v1/bookmarks/7', 'DELETE');
    expect(res.status).toHaveBeenLastCalledWith(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('drops trailing slashes from the server URL and keeps its sub-path', async () => {
    fetchMock.mockResolvedValue(new Response('[]', { status: 200 }));
    const res = await call('https://books.example.com//');
    expect(res.status).toHaveBeenLastCalledWith(200);
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://books.example.com/api/v1/books',
      expect.objectContaining({ method: 'GET' }),
    );

    await call('https://example.com/grimmory/');
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://example.com/grimmory/api/v1/books',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('builds the URL quickly from a server URL with many inner slashes', async () => {
    fetchMock.mockResolvedValue(new Response('[]', { status: 200 }));
    const start = performance.now();
    const res = await call(`https://books.example.com${'/'.repeat(50_000)}x`);
    expect(performance.now() - start).toBeLessThan(500);
    expect(res.status).toHaveBeenLastCalledWith(200);
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringMatching(/x\/api\/v1\/books$/),
      expect.objectContaining({ method: 'GET' }),
    );
  });
});
