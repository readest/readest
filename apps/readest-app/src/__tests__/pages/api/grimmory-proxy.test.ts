import { describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import handler, { isValidGrimmoryRequest } from '@/pages/api/grimmory';

vi.mock('@/utils/cors', () => ({ corsAllMethods: {}, runMiddleware: vi.fn() }));

const call = async (serverUrl: string, path = '/api/v1/books', method = 'GET') => {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), send: vi.fn() };
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
});
