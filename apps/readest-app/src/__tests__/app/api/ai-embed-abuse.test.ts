import { describe, it, expect, vi, beforeEach } from 'vitest';

// The embed proxy forwarded an unbounded `texts` array to the paid AI Gateway
// with no size cap and no abort signal. The model here is server-configured
// (the client cannot pick it), so the bound is on input size plus a timeout.

const validateUserAndTokenMock = vi.fn();
const embedMock = vi.fn();
const embedManyMock = vi.fn();

vi.mock('@/utils/access', () => ({
  validateUserAndToken: (...a: unknown[]) => validateUserAndTokenMock(...a),
}));
vi.mock('ai', () => ({
  createGateway: () => ({ embeddingModel: (m: string) => ({ __model: m }) }),
  embed: (...a: unknown[]) => embedMock(...a),
  embedMany: (...a: unknown[]) => embedManyMock(...a),
}));

import { POST } from '@/app/api/ai/embed/route';

const makeReq = (body: Record<string, unknown>) =>
  new Request('http://localhost/api/ai/embed', {
    method: 'POST',
    headers: { authorization: 'Bearer tok', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  validateUserAndTokenMock.mockReset().mockResolvedValue({ user: { id: 'u1' }, token: 'tok' });
  embedMock.mockReset().mockResolvedValue({ embedding: [0.1] });
  embedManyMock.mockReset().mockResolvedValue({ embeddings: [[0.1]] });
  process.env['AI_GATEWAY_API_KEY'] = 'server-key';
});

describe('POST /api/ai/embed — cost-abuse hardening', () => {
  it('rejects a batch with too many texts', async () => {
    const texts = Array.from({ length: 500 }, () => 'x');
    const res = await POST(makeReq({ texts }));

    expect(res.status).toBe(413);
    expect(embedManyMock).not.toHaveBeenCalled();
  });

  it('rejects a batch whose total size is too large', async () => {
    const texts = [`${'a'.repeat(600_000)}`];
    const res = await POST(makeReq({ texts }));

    expect(res.status).toBe(413);
    expect(embedMock).not.toHaveBeenCalled();
  });

  it('passes an abort signal to embedMany for a valid batch', async () => {
    const res = await POST(makeReq({ texts: ['a', 'b'] }));

    expect(res.status).toBe(200);
    expect(embedManyMock).toHaveBeenCalledTimes(1);
    const args = embedManyMock.mock.calls[0]![0] as { abortSignal?: AbortSignal };
    expect(args.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('passes an abort signal to embed for a single value', async () => {
    const res = await POST(makeReq({ texts: ['a'], single: true }));

    expect(res.status).toBe(200);
    expect(embedMock).toHaveBeenCalledTimes(1);
    const args = embedMock.mock.calls[0]![0] as { abortSignal?: AbortSignal };
    expect(args.abortSignal).toBeInstanceOf(AbortSignal);
  });
});
