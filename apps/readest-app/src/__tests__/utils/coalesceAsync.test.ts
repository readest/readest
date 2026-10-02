import { describe, it, expect, vi } from 'vitest';
import { coalesceAsync } from '@/utils/coalesceAsync';

const deferred = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};

describe('coalesceAsync', () => {
  it('never overlaps runs, and coalesces queued calls into one rerun with the latest arguments', async () => {
    const first = deferred();
    let active = 0;
    let maxActive = 0;
    const seen: number[] = [];
    const fn = vi.fn(async (n: number) => {
      active++;
      maxActive = Math.max(maxActive, active);
      if (n === 1) await first.promise;
      seen.push(n);
      active--;
    });
    const run = coalesceAsync(fn);

    const call1 = run(1);
    await Promise.resolve();
    const call2 = run(2);
    await Promise.resolve(); // a call queued a tick later still joins the same rerun
    const call3 = run(3);
    first.release();
    await Promise.all([call1, call2, call3]);

    expect(maxActive).toBe(1);
    expect(seen).toEqual([1, 3]);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("settles a queued caller's promise only once the coalesced rerun finishes", async () => {
    const first = deferred();
    const second = deferred();
    const fn = vi.fn(async () => {
      await (fn.mock.calls.length === 1 ? first : second).promise;
    });
    const run = coalesceAsync(fn);

    const firstCall = run();
    await Promise.resolve();
    let queuedResolved = false;
    const queued = run().then(() => {
      queuedResolved = true;
    });

    first.release();
    // Let the coalesced rerun start (and block on its own work).
    await Promise.resolve();
    await Promise.resolve();
    expect(queuedResolved).toBe(false);

    second.release();
    await Promise.all([firstCall, queued]);
    expect(queuedResolved).toBe(true);
  });

  it('still settles a queued caller when the coalesced rerun throws', async () => {
    const first = deferred();
    const fn = vi.fn(async () => {
      if (fn.mock.calls.length === 1) await first.promise;
      else throw new Error('rerun failed');
    });
    const run = coalesceAsync(fn);

    const firstCall = run();
    const firstRejected = expect(firstCall).rejects.toThrow('rerun failed');
    await Promise.resolve();
    const queued = run();

    first.release();
    await expect(queued).resolves.toBeUndefined();
    await firstRejected;
  });
});
