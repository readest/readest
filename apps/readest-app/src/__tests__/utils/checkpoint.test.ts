import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createThrottledCheckpoint } from '@/utils/checkpoint';

/**
 * Import checkpointing (#5601): during a long folder import the library index
 * must be persisted periodically — not once at the very end — so a crash/kill
 * mid-import loses at most one interval of work instead of the entire run.
 * The saver must coalesce bursts (full-library serialization is expensive),
 * never overlap two saves, and guarantee a final save via flush().
 */
describe('createThrottledCheckpoint', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('saves immediately on the first touch and coalesces touches within the interval', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const checkpoint = createThrottledCheckpoint(save, 1000);

    checkpoint.touch();
    expect(save).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(500);
    checkpoint.touch();
    checkpoint.touch();
    expect(save).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(500);
    checkpoint.touch();
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('never overlaps saves even when a save outlives the interval', async () => {
    let resolveSave!: () => void;
    const save = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const checkpoint = createThrottledCheckpoint(save, 1000);

    checkpoint.touch();
    expect(save).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    checkpoint.touch();
    expect(save).toHaveBeenCalledTimes(1);

    resolveSave();
    await vi.advanceTimersByTimeAsync(1000);
    checkpoint.touch();
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('flush() is a no-op when the state is already saved', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const checkpoint = createThrottledCheckpoint(save, 1000);

    checkpoint.touch();
    await checkpoint.flush();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('flush() waits for the in-flight save and then persists dirty state', async () => {
    let resolveSave!: () => void;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveSave = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const checkpoint = createThrottledCheckpoint(save, 1000);

    checkpoint.touch();
    checkpoint.touch(); // dirty while save #1 is in flight
    const flushed = checkpoint.flush();
    resolveSave();
    await flushed;

    expect(save).toHaveBeenCalledTimes(2);
  });

  it('a failed touch-save keeps the state dirty so flush() retries', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined);
    const checkpoint = createThrottledCheckpoint(save, 1000);

    checkpoint.touch();
    await vi.advanceTimersByTimeAsync(0);

    await checkpoint.flush();
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('flush() propagates a save failure', async () => {
    const save = vi.fn().mockRejectedValue(new Error('disk full'));
    const checkpoint = createThrottledCheckpoint(save, 1000);

    checkpoint.touch();
    await vi.advanceTimersByTimeAsync(0);

    await expect(checkpoint.flush()).rejects.toThrow('disk full');
  });
});
