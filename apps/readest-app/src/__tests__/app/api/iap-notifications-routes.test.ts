import { describe, it, expect, vi, beforeEach } from 'vitest';

// Route-level concerns for the App Store / Google Play webhook endpoints:
// payload validation and the Google Pub/Sub shared-secret token. The status
// mapping itself is covered by the handler tests.

const hooks = vi.hoisted(() => ({
  handleAppleNotification: vi.fn(),
  handleGoogleNotification: vi.fn(),
}));

vi.mock('@/libs/payment/iap/apple/notifications', () => ({
  handleAppleNotification: hooks.handleAppleNotification,
}));
vi.mock('@/libs/payment/iap/google/notifications', () => ({
  handleGoogleNotification: hooks.handleGoogleNotification,
}));

import { POST as applePOST } from '@/app/api/apple/notifications/route';
import { POST as googlePOST } from '@/app/api/google/notifications/route';

const jsonReq = (url: string, body: unknown) =>
  new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  hooks.handleAppleNotification.mockReset();
  hooks.handleGoogleNotification.mockReset();
  hooks.handleAppleNotification.mockResolvedValue({ handled: true, status: 'active' });
  hooks.handleGoogleNotification.mockResolvedValue({ handled: true, status: 'active' });
  delete process.env['GOOGLE_RTDN_VERIFICATION_TOKEN'];
});

describe('POST /api/apple/notifications', () => {
  it('rejects a request without a signedPayload', async () => {
    const res = await applePOST(jsonReq('https://web.readest.com/api/apple/notifications', {}));
    expect(res.status).toBe(400);
    expect(hooks.handleAppleNotification).not.toHaveBeenCalled();
  });

  it('processes a signed payload', async () => {
    const res = await applePOST(
      jsonReq('https://web.readest.com/api/apple/notifications', { signedPayload: 'jws' }),
    );
    expect(res.status).toBe(200);
    expect(hooks.handleAppleNotification).toHaveBeenCalledWith('jws');
  });

  it('returns 500 when processing throws so Apple retries', async () => {
    hooks.handleAppleNotification.mockRejectedValue(new Error('db down'));
    const res = await applePOST(
      jsonReq('https://web.readest.com/api/apple/notifications', { signedPayload: 'jws' }),
    );
    expect(res.status).toBe(500);
  });
});

describe('POST /api/google/notifications', () => {
  it('rejects a request with an invalid verification token', async () => {
    process.env['GOOGLE_RTDN_VERIFICATION_TOKEN'] = 'secret';
    const res = await googlePOST(
      jsonReq('https://web.readest.com/api/google/notifications?token=wrong', {
        message: { data: 'abc' },
      }),
    );
    expect(res.status).toBe(401);
    expect(hooks.handleGoogleNotification).not.toHaveBeenCalled();
  });

  it('processes a message when the token matches', async () => {
    process.env['GOOGLE_RTDN_VERIFICATION_TOKEN'] = 'secret';
    const res = await googlePOST(
      jsonReq('https://web.readest.com/api/google/notifications?token=secret', {
        message: { data: 'abc' },
      }),
    );
    expect(res.status).toBe(200);
    expect(hooks.handleGoogleNotification).toHaveBeenCalledWith('abc');
  });

  it('acknowledges an empty Pub/Sub message without processing', async () => {
    const res = await googlePOST(
      jsonReq('https://web.readest.com/api/google/notifications', { message: {} }),
    );
    expect(res.status).toBe(200);
    expect(hooks.handleGoogleNotification).not.toHaveBeenCalled();
    const json = (await res.json()) as { reason?: string };
    expect(json.reason).toBe('empty_message');
  });
});
