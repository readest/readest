import { describe, expect, it } from 'vitest';
import { DispatchQueue, type SlotRequest } from '@/libs/readestVoice/dispatchQueue';

const LEASE_MS = 180_000;
const WAIT_MS = 60_000;

// Unique across queues, as request tokens are.
let n = 0;

const setup = (capacity: number) => {
  let now = 1_000;
  const queue = new DispatchQueue(
    { capacity, leaseMs: LEASE_MS, waitMs: WAIT_MS, maxWaiting: 2 },
    () => now,
  );
  const ask = (userId: string, lane: SlotRequest['lane'] = 'listen', clientId = `${userId}-c`) => {
    const token = `t${++n}`;
    let result: Awaited<ReturnType<DispatchQueue['acquire']>> | undefined;
    void queue.acquire({ userId, clientId, lane, token }).then((r) => (result = r));
    return { token, result: () => result };
  };
  const advance = (ms: number) => {
    now += ms;
    queue.sweep();
  };
  return { queue, ask, advance };
};

// Promise callbacks run as microtasks.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('DispatchQueue', () => {
  it('admits up to capacity, then queues until a slot frees', async () => {
    const { queue, ask } = setup(2);
    const a = ask('a');
    const b = ask('b');
    const c = ask('c');
    await flush();
    expect(a.result()).toEqual({ acquired: true, previousJobId: null });
    expect(b.result()?.acquired).toBe(true);
    expect(c.result()).toBeUndefined();

    queue.release(a.token);
    await flush();
    expect(c.result()?.acquired).toBe(true);
  });

  it('runs one window per user and lane; another device of the user waits its turn', async () => {
    const { queue, ask } = setup(4);
    const first = ask('a', 'listen', 'phone');
    const second = ask('a', 'listen', 'tablet');
    const download = ask('a', 'download', 'phone');
    await flush();
    expect(first.result()?.acquired).toBe(true);
    expect(second.result()).toBeUndefined();
    expect(download.result()?.acquired).toBe(true);

    queue.release(first.token);
    await flush();
    expect(second.result()?.acquired).toBe(true);
  });

  it('serves the user served least recently first', async () => {
    const { queue, ask } = setup(1);
    const a1 = ask('a', 'listen', 'phone');
    const a2 = ask('a', 'listen', 'tablet');
    const b = ask('b');
    await flush();
    expect(a1.result()?.acquired).toBe(true);

    // a's second device asked before b, but a was just served.
    queue.release(a1.token);
    await flush();
    expect(b.result()?.acquired).toBe(true);
    expect(a2.result()).toBeUndefined();

    // a's next window arrives only after b was served: a is now due first.
    queue.release(b.token);
    await flush();
    expect(a2.result()?.acquired).toBe(true);
  });

  it('serves listening first but keeps a share for downloads', async () => {
    const { queue, ask } = setup(2);
    const a = ask('a');
    const b = ask('b');
    const listen = ask('c');
    const download = ask('d', 'download');
    await flush();

    // No download running: the reserved slot goes to the waiting download.
    queue.release(a.token);
    await flush();
    expect(download.result()?.acquired).toBe(true);
    expect(listen.result()).toBeUndefined();

    queue.release(b.token);
    await flush();
    expect(listen.result()?.acquired).toBe(true);
  });

  it('lets a client replace its own running listen window without queueing', async () => {
    const { queue, ask } = setup(1);
    const old = ask('a');
    const other = ask('b');
    await flush();
    queue.setJob(old.token, 'job-1');

    // A seek: the same client asks again while the slot is full.
    const seek = ask('a');
    await flush();
    expect(seek.result()).toEqual({ acquired: true, previousJobId: 'job-1' });
    expect(queue.setJob(old.token, 'job-x')).toBe(false);
    expect(other.result()).toBeUndefined();

    // The stale request's late release must not free the new window's slot.
    queue.release(old.token);
    await flush();
    expect(other.result()).toBeUndefined();
  });

  it('drops a waiting listen window its client replaced', async () => {
    const { ask } = setup(1);
    ask('b');
    const stale = ask('a');
    const fresh = ask('a');
    await flush();
    expect(stale.result()).toEqual({ acquired: false, previousJobId: null });
    expect(fresh.result()).toBeUndefined();
  });

  it('refuses a user who already has the most windows waiting in a lane', async () => {
    const { ask } = setup(1);
    ask('a', 'download', 'phone');
    ask('a', 'download', 'tablet');
    ask('a', 'download', 'laptop');
    const extra = ask('a', 'download', 'tv');
    await flush();
    expect(extra.result()?.acquired).toBe(false);
  });

  it('withdraws a waiting window when its request goes away', async () => {
    const { queue, ask } = setup(1);
    const a = ask('a');
    const b = ask('b');
    const c = ask('c');
    queue.release(b.token);
    await flush();
    expect(b.result()?.acquired).toBe(false);

    queue.release(a.token);
    await flush();
    expect(c.result()?.acquired).toBe(true);
  });

  it('gives up on long waits and frees expired leases', async () => {
    const { queue, ask, advance } = setup(1);
    const a = ask('a');
    const b = ask('b');
    await flush();
    expect(queue.nextDeadline()).toBe(1_000 + WAIT_MS);

    advance(WAIT_MS);
    await flush();
    expect(b.result()?.acquired).toBe(false);

    advance(LEASE_MS - WAIT_MS - 10_000);
    const c = ask('c');
    advance(10_000);
    await flush();
    expect(c.result()?.acquired).toBe(true);
    expect(queue.setJob(a.token, 'job')).toBe(false);
  });

  it('keeps restored leases counting against capacity', async () => {
    const first = setup(1);
    const a = first.ask('a');
    await flush();
    first.queue.setJob(a.token, 'job-1');

    const { queue, ask } = setup(1);
    queue.restore(first.queue.snapshot());
    const b = ask('b');
    await flush();
    expect(b.result()).toBeUndefined();
    queue.release(a.token);
    await flush();
    expect(b.result()?.acquired).toBe(true);
  });

  it('admits a bridged download at once only within its share while listening waits', async () => {
    const { queue, ask } = setup(4);
    const bridged = (token: string) =>
      queue.tryAcquire({ userId: 'bridge', clientId: 'bridge', lane: 'download', token });
    expect(bridged('d1')).toBe(true);
    ask('a');
    ask('b');
    ask('a', 'listen', 'tablet');
    await flush();
    // One slot left, a listen window waits, and downloads have their share.
    expect(bridged('d2')).toBe(false);
    // Back within the share once the first ends.
    queue.release('d1');
    expect(bridged('d3')).toBe(true);
  });

  it('renews a running lease so it outlives the window deadline', async () => {
    const { queue, ask, advance } = setup(1);
    const a = ask('a');
    await flush();
    advance(LEASE_MS - 1_000);
    expect(queue.renew(a.token)).toBe(true);
    advance(2_000);
    expect(queue.setJob(a.token, 'job-1')).toBe(true);
    expect(queue.renew('missing')).toBe(false);
  });
});
