import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// IAP webhook telemetry: a structured log line (for `wrangler tail`) plus a
// Cloudflare Analytics Engine data point (100% capture, independent of the
// head-sampled Workers Logs). Must no-op gracefully off the Worker runtime.

const cf = vi.hoisted(() => ({ getCloudflareContext: vi.fn() }));
vi.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: cf.getCloudflareContext }));

import { recordIapWebhook, recordIapReconcile } from '@/libs/payment/iap/telemetry';

type DataPoint = { indexes?: string[]; blobs?: (string | null)[]; doubles?: number[] };

let writeDataPoint: ReturnType<typeof vi.fn>;
let logSpy: ReturnType<typeof vi.spyOn>;

const firstDataPoint = (): DataPoint => writeDataPoint.mock.calls[0]![0] as DataPoint;

beforeEach(() => {
  writeDataPoint = vi.fn();
  cf.getCloudflareContext.mockReturnValue({ env: { IAP_WEBHOOK_AE: { writeDataPoint } } });
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  cf.getCloudflareContext.mockReset();
});

describe('recordIapWebhook', () => {
  it('writes an Analytics Engine data point indexed by provider', () => {
    recordIapWebhook({
      provider: 'apple',
      outcome: 'handled',
      notificationType: 'DID_RENEW',
      status: 'active',
      durationMs: 12,
    });

    expect(writeDataPoint).toHaveBeenCalledTimes(1);
    const point = firstDataPoint();
    expect(point.indexes).toEqual(['apple']);
    expect(point.blobs).toEqual(['webhook', 'apple', 'handled', 'DID_RENEW', 'active', '']);
    expect(point.doubles).toEqual([12]);
  });

  it('emits a tagged structured log line', () => {
    recordIapWebhook({ provider: 'google', outcome: 'error', reason: 'db down', durationMs: 5 });

    const logged = JSON.parse(logSpy.mock.calls.at(-1)![0] as string);
    expect(logged).toMatchObject({
      tag: 'iap-webhook',
      kind: 'webhook',
      provider: 'google',
      outcome: 'error',
      reason: 'db down',
    });
  });

  it('does not throw and still logs outside the Worker runtime', () => {
    cf.getCloudflareContext.mockImplementation(() => {
      throw new Error('no cloudflare context');
    });

    expect(() =>
      recordIapWebhook({ provider: 'apple', outcome: 'handled', durationMs: 1 }),
    ).not.toThrow();
    expect(logSpy).toHaveBeenCalled();
    expect(writeDataPoint).not.toHaveBeenCalled();
  });

  it('no-ops the data point when the AE binding is absent', () => {
    cf.getCloudflareContext.mockReturnValue({ env: {} });

    expect(() =>
      recordIapWebhook({ provider: 'apple', outcome: 'handled', durationMs: 1 }),
    ).not.toThrow();
    expect(writeDataPoint).not.toHaveBeenCalled();
  });
});

describe('recordIapReconcile', () => {
  it('records drift counts as doubles and flags drift', () => {
    recordIapReconcile({ appleDrift: 2, googleDrift: 1, durationMs: 30 });

    const point = firstDataPoint();
    expect(point.indexes).toEqual(['reconcile']);
    expect(point.blobs).toEqual(['reconcile', 'drift']);
    expect(point.doubles).toEqual([2, 1, 30]);
  });

  it('flags ok when there is no drift', () => {
    recordIapReconcile({ appleDrift: 0, googleDrift: 0, durationMs: 9 });
    expect(firstDataPoint().blobs).toEqual(['reconcile', 'ok']);
  });
});
