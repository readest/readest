// @vitest-environment node
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { apiResolver } from 'next/dist/server/api-utils/node/api-resolver';

// No user: a body that gets past Next's body parser reaches the handler and
// is answered 403, so nothing is written.
vi.mock('@/utils/access', () => ({
  validateUserAndToken: async () => ({ user: null, token: null }),
}));
vi.mock('@/utils/cors', () => ({ corsAllMethods: {}, runMiddleware: vi.fn() }));

import * as syncRoute from '@/pages/api/sync';

// The route served the way Next serves a Pages Router API route: the body
// parser reads `config.api.bodyParser` from the route module.
const server = createServer((req, res) =>
  apiResolver(req, res, {}, syncRoute, { dev: false } as never, false, false, '/api/sync'),
);
let url = '';

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/sync`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const MB = 1024 * 1024;
const pushOfSize = (bytes: number) =>
  JSON.stringify({ books: [{ hash: 'h', title: 'x'.repeat(bytes) }] });

const post = async (body: string) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  return { status: res.status, text: await res.text() };
};

describe('POST /api/sync body limit', () => {
  // Clients before #7814 push every changed book in one request: a library
  // bulk-imported within the push look-back is ~1.6 MB for ~1000 books.
  it('accepts the single-request push of a ~1000-book library', async () => {
    const { status, text } = await post(pushOfSize(1.6 * MB));

    expect(text).not.toContain('Body exceeded');
    expect(status).toBe(403);
  });

  // The body is parsed before the handler checks auth, at about 4x its size
  // in Worker heap, so the limit stays bounded.
  it('still rejects a push over 8 MB', async () => {
    const { status, text } = await post(pushOfSize(8.5 * MB));

    expect(status).toBe(413);
    expect(text).toContain('Body exceeded 8mb limit');
  });
});
