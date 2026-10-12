import { describe, it, expect, vi, beforeEach } from 'vitest';

// The AI chat proxy used to fall back to the server's own paid AI Gateway key
// (`process.env.AI_GATEWAY_API_KEY`) for any logged-in user, let the client
// pick any `model`, and passed `messages`/`system` straight through with no
// size bound, no `maxOutputTokens`, and no `abortSignal`. That is an unbounded
// cost-DoS. The hardening:
//   - when falling back to the SERVER key, the requested model must be on the
//     cheap allow-list (a user bringing their own key keeps full model choice);
//   - the message count and total content size are capped;
//   - every request sets `maxOutputTokens` and an `abortSignal`.

const validateUserAndTokenMock = vi.fn();
const streamTextMock = vi.fn();

vi.mock('@/utils/access', () => ({
  validateUserAndToken: (...a: unknown[]) => validateUserAndTokenMock(...a),
}));
vi.mock('ai', () => ({
  createGateway: () => {
    const gateway = (model: string) => ({ __model: model });
    return gateway;
  },
  streamText: (...a: unknown[]) => streamTextMock(...a),
}));

import { POST } from '@/app/api/ai/chat/route';

const makeReq = (body: Record<string, unknown>, auth = 'Bearer tok') =>
  new Request('http://localhost/api/ai/chat', {
    method: 'POST',
    headers: { authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  validateUserAndTokenMock.mockReset().mockResolvedValue({ user: { id: 'u1' }, token: 'tok' });
  streamTextMock.mockReset().mockReturnValue({
    toTextStreamResponse: () => new Response('ok'),
  });
  process.env['AI_GATEWAY_API_KEY'] = 'server-key';
});

describe('POST /api/ai/chat — cost-abuse hardening', () => {
  it('rejects a non-allow-listed model when falling back to the server key', async () => {
    const res = await POST(
      makeReq({ messages: [{ role: 'user', content: 'hi' }], model: 'openai/gpt-5' }),
    );

    expect(res.status).toBe(400);
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it('allows a BYO key to use any (custom) model', async () => {
    const res = await POST(
      makeReq({
        messages: [{ role: 'user', content: 'hi' }],
        model: 'openai/gpt-5',
        apiKey: 'user-own-key',
      }),
    );

    expect(res.status).toBe(200);
    expect(streamTextMock).toHaveBeenCalledTimes(1);
  });

  it('allows an allow-listed model on the server key and bounds output + abort', async () => {
    const res = await POST(
      makeReq({
        messages: [{ role: 'user', content: 'hi' }],
        model: 'google/gemini-2.5-flash-lite',
      }),
    );

    expect(res.status).toBe(200);
    expect(streamTextMock).toHaveBeenCalledTimes(1);
    const args = streamTextMock.mock.calls[0]![0] as {
      maxOutputTokens?: number;
      abortSignal?: AbortSignal;
    };
    expect(typeof args.maxOutputTokens).toBe('number');
    expect(args.maxOutputTokens).toBeGreaterThan(0);
    expect(args.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('rejects a request with too many messages', async () => {
    const messages = Array.from({ length: 200 }, () => ({ role: 'user', content: 'x' }));
    const res = await POST(makeReq({ messages, model: 'google/gemini-2.5-flash-lite' }));

    expect(res.status).toBe(413);
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it('rejects a request whose total content size is too large', async () => {
    const messages = [{ role: 'user', content: 'a'.repeat(200_000) }];
    const res = await POST(makeReq({ messages, model: 'google/gemini-2.5-flash-lite' }));

    expect(res.status).toBe(413);
    expect(streamTextMock).not.toHaveBeenCalled();
  });
});
