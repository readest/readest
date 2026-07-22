import { describe, it, expect, vi, beforeEach } from 'vitest';

// GHSA-pv88-3727-j7v8: `/api/stripe/check` retrieves a client-supplied
// `sessionId` and writes the paid plan onto the *caller's* account without
// checking the session belongs to them. A single paid session id could be
// replayed to upgrade unlimited free accounts. The handler must reject when
// `session.metadata.userId` does not match the authenticated caller.

const retrieveMock = vi.fn();
const validateUserAndTokenMock = vi.fn();
const createOrUpdateSubscriptionMock = vi.fn();
const createOrUpdatePaymentMock = vi.fn();

vi.mock('@/libs/payment/stripe/server', () => ({
  getStripe: () => ({
    checkout: { sessions: { retrieve: (...a: unknown[]) => retrieveMock(...a) } },
  }),
  createOrUpdateSubscription: (...a: unknown[]) => createOrUpdateSubscriptionMock(...a),
  createOrUpdatePayment: (...a: unknown[]) => createOrUpdatePaymentMock(...a),
}));
vi.mock('@/utils/access', () => ({
  validateUserAndToken: (...a: unknown[]) => validateUserAndTokenMock(...a),
}));

import { POST } from '@/app/api/stripe/check/route';

const postReq = (sessionId: string) =>
  new Request('https://web.readest.com/api/stripe/check', {
    method: 'POST',
    headers: { authorization: 'Bearer caller', 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  });

beforeEach(() => {
  validateUserAndTokenMock.mockReset().mockResolvedValue({
    user: { id: 'caller-id' },
    token: 'tok',
  });
  retrieveMock.mockReset();
  createOrUpdateSubscriptionMock.mockReset().mockResolvedValue(undefined);
  createOrUpdatePaymentMock.mockReset().mockResolvedValue(undefined);
});

describe('POST /api/stripe/check — session ownership', () => {
  it('rejects a paid session owned by a different user and grants nothing', async () => {
    retrieveMock.mockResolvedValue({
      payment_status: 'paid',
      subscription: 'sub_1',
      customer: 'cus_1',
      metadata: { userId: 'someone-else' },
    });
    const res = await POST(postReq('cs_live_victim'));
    expect(res.status).toBe(403);
    expect(createOrUpdateSubscriptionMock).not.toHaveBeenCalled();
    expect(createOrUpdatePaymentMock).not.toHaveBeenCalled();
  });

  it('rejects a paid session with no userId metadata', async () => {
    retrieveMock.mockResolvedValue({
      payment_status: 'paid',
      subscription: 'sub_1',
      customer: 'cus_1',
      metadata: {},
    });
    const res = await POST(postReq('cs_live_orphan'));
    expect(res.status).toBe(403);
    expect(createOrUpdateSubscriptionMock).not.toHaveBeenCalled();
  });

  it('binds a paid session that belongs to the caller', async () => {
    retrieveMock.mockResolvedValue({
      payment_status: 'paid',
      subscription: 'sub_1',
      customer: 'cus_1',
      metadata: { userId: 'caller-id' },
    });
    const res = await POST(postReq('cs_live_own'));
    expect(res.status).toBe(200);
    expect(createOrUpdateSubscriptionMock).toHaveBeenCalledWith('caller-id', 'cus_1', 'sub_1');
  });
});
