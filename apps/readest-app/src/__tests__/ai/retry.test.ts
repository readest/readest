import { describe, test, expect, vi } from 'vitest';
import { withRetry, withTimeout, AI_TIMEOUTS, AI_RETRY_CONFIGS } from '@/services/ai/utils/retry';

describe('withRetry', () => {
  test('should return result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('success');
    const result = await withRetry(fn);

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('should retry on failure and succeed', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValue('success');

    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 5 });

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test('should throw after max retries', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));

    await expect(withRetry(fn, { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 5 })).rejects.toThrow(
      'always fails',
    );

    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  test('should not retry on AbortError', async () => {
    const abortError = new Error('Aborted');
    abortError.name = 'AbortError';
    const fn = vi.fn().mockRejectedValue(abortError);

    await expect(withRetry(fn, { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 5 })).rejects.toThrow(
      'Aborted',
    );

    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('should call onRetry callback', async () => {
    const onRetry = vi.fn();
    const fn = vi.fn().mockRejectedValueOnce(new Error('fail')).mockResolvedValue('success');

    await withRetry(fn, { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 5, onRetry });

    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error));
  });
});

describe('withTimeout', () => {
  test('should return result before timeout', async () => {
    const promise = Promise.resolve('fast');
    const result = await withTimeout(promise, 1000);
    expect(result).toBe('fast');
  });

  test('should throw on timeout', async () => {
    const slowPromise = new Promise((resolve) => setTimeout(resolve, 5000));

    await expect(withTimeout(slowPromise, 10)).rejects.toThrow('Timeout after 10ms');
  });

  test('should use custom message', async () => {
    const slowPromise = new Promise((resolve) => setTimeout(resolve, 5000));

    await expect(withTimeout(slowPromise, 10, 'Custom timeout')).rejects.toThrow('Custom timeout');
  });
});

describe('AI_TIMEOUTS', () => {
  test('should have correct timeout values', () => {
    expect(AI_TIMEOUTS.EMBEDDING_SINGLE).toBe(30_000);
    expect(AI_TIMEOUTS.EMBEDDING_BATCH).toBe(120_000);
    expect(AI_TIMEOUTS.CHAT_STREAM).toBe(60_000);
    expect(AI_TIMEOUTS.HEALTH_CHECK).toBe(5_000);
    expect(AI_TIMEOUTS.OLLAMA_CONNECT).toBe(5_000);
  });
});

describe('AI_RETRY_CONFIGS', () => {
  test('should have correct retry configs', () => {
    expect(AI_RETRY_CONFIGS.EMBEDDING.maxRetries).toBe(3);
    expect(AI_RETRY_CONFIGS.CHAT.maxRetries).toBe(2);
    expect(AI_RETRY_CONFIGS.HEALTH_CHECK.maxRetries).toBe(1);
  });
});
