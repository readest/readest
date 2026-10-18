import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createGatewayMock = vi.fn();
const streamTextMock = vi.fn();
const embedManyMock = vi.fn();

vi.mock('@/utils/access', () => ({
  validateUserAndToken: vi.fn().mockResolvedValue({ user: { id: 'user-1' }, token: 'tok' }),
}));
vi.mock('ai', () => ({
  createGateway: (...a: unknown[]) => createGatewayMock(...a),
  streamText: (...a: unknown[]) => streamTextMock(...a),
  embed: vi.fn(),
  embedMany: (...a: unknown[]) => embedManyMock(...a),
}));

import { POST as chatPOST } from '@/app/api/ai/chat/route';
import { POST as embedPOST } from '@/app/api/ai/embed/route';

const post = (path: string, body: unknown) =>
  new Request(`https://web.readest.com/api/ai/${path}`, {
    method: 'POST',
    headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.stubEnv('AI_GATEWAY_API_KEY', 'server-key');
  const gateway = Object.assign(
    vi.fn(() => 'model'),
    { embeddingModel: vi.fn(() => 'embedding-model') },
  );
  createGatewayMock.mockReset().mockReturnValue(gateway);
  streamTextMock
    .mockReset()
    .mockReturnValue({ toTextStreamResponse: () => new Response('streamed') });
  embedManyMock.mockReset().mockResolvedValue({ embeddings: [[0.1]] });
});
afterEach(() => vi.unstubAllEnvs());

describe('AI gateway routes', () => {
  it('chat requires the caller to supply an API key', async () => {
    const res = await chatPOST(post('chat', { messages: [{ role: 'user', content: 'hi' }] }));
    expect(res.status).toBe(401);
    expect(createGatewayMock).not.toHaveBeenCalled();
  });

  it('embed requires the caller to supply an API key', async () => {
    const res = await embedPOST(post('embed', { texts: ['hi'] }));
    expect(res.status).toBe(401);
    expect(createGatewayMock).not.toHaveBeenCalled();
  });

  it('chat rejects a non-string system prompt', async () => {
    const res = await chatPOST(
      post('chat', {
        messages: [{ role: 'user', content: 'hi' }],
        system: { text: 'x'.repeat(600_000) },
        apiKey: 'user-key',
      }),
    );
    expect(res.status).toBe(400);
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it('chat uses the caller key', async () => {
    const res = await chatPOST(
      post('chat', { messages: [{ role: 'user', content: 'hi' }], apiKey: 'user-key' }),
    );
    expect(res.status).toBe(200);
    expect(createGatewayMock).toHaveBeenCalledWith({ apiKey: 'user-key' });
  });

  it('chat rejects too many messages', async () => {
    const messages = Array.from({ length: 501 }, () => ({ role: 'user', content: 'hi' }));
    const res = await chatPOST(post('chat', { messages, apiKey: 'user-key' }));
    expect(res.status).toBe(413);
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it('chat rejects oversized input', async () => {
    const res = await chatPOST(
      post('chat', {
        messages: [{ role: 'user', content: 'a'.repeat(400_000) }],
        system: 'a'.repeat(100_001),
        apiKey: 'user-key',
      }),
    );
    expect(res.status).toBe(413);
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it('embed rejects more texts than one embedding call takes', async () => {
    const texts = Array.from({ length: 101 }, () => 'hi');
    const res = await embedPOST(post('embed', { texts, apiKey: 'user-key' }));
    expect(res.status).toBe(413);
    expect(embedManyMock).not.toHaveBeenCalled();
  });

  it('embed rejects non-string texts', async () => {
    const res = await embedPOST(post('embed', { texts: ['hi', { a: 1 }], apiKey: 'user-key' }));
    expect(res.status).toBe(400);
    expect(embedManyMock).not.toHaveBeenCalled();
  });

  it('embed uses the caller key', async () => {
    const res = await embedPOST(post('embed', { texts: ['a', 'b'], apiKey: 'user-key' }));
    expect(res.status).toBe(200);
    expect(createGatewayMock).toHaveBeenCalledWith({ apiKey: 'user-key' });
  });
});
