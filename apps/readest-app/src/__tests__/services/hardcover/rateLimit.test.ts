import { describe, test, expect } from 'vitest';
import { parseRateLimit, parseRetryAfterMs, RateLimitGate } from '@/services/hardcover/rateLimit';

describe('hardcover rateLimit parsing', () => {
  test('parseRateLimit reads minute and daily buckets, ignoring malformed input', () => {
    expect(parseRateLimit('"Free";r=8;t=42, "daily";r=4231;t=51234')).toEqual({
      minute: { remaining: 8, resetSec: 42 },
      daily: { remaining: 4231, resetSec: 51234 },
    });
    expect(parseRateLimit('garbage, "Free";r=x')).toEqual({});
    expect(parseRateLimit(null)).toEqual({});
  });

  test('parseRetryAfterMs converts seconds and rejects invalid values', () => {
    expect(parseRetryAfterMs('3')).toBe(3000);
    expect(parseRetryAfterMs('abc')).toBeNull();
    expect(parseRetryAfterMs(null)).toBeNull();
  });

  test('batchSize is the remaining quota, defaulting to the free burst limit', () => {
    const gate = new RateLimitGate();
    expect(gate.batchSize).toBe(10);
    gate.update(new Headers({ RateLimit: '"S";r=14;t=5' }));
    expect(gate.batchSize).toBe(14);
    gate.update(new Headers({ RateLimit: '"S";r=14;t=5, "daily";r=3;t=900' }));
    expect(gate.batchSize).toBe(3);
  });
});
