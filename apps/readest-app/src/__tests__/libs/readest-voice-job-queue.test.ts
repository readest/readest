import { describe, expect, it } from 'vitest';
import { JobQueue, type JobSubmission } from '@/libs/readestVoice/jobQueue';

const LEASE_MS = 120_000;
const RETAIN_MS = 86_400_000;

const setup = (maxQueuedPerUser = 3) => {
  let now = 1_000;
  const queue = new JobQueue(
    { leaseMs: LEASE_MS, maxAttempts: 2, maxQueuedPerUser, retainMs: RETAIN_MS },
    () => now,
  );
  let n = 0;
  const submit = (userId: string, overrides: Partial<JobSubmission> = {}) => {
    const id = overrides.id ?? `job${++n}`;
    const result = queue.submit({
      id,
      userId,
      plan: 'pro',
      lang: 'en',
      segments: [{ id: 's0', text: 'Hello there.', voice: 'kokoro:af_heart' }],
      engines: ['kokoro'],
      quotaLeft: 1_000,
      ...overrides,
    });
    return { id, result };
  };
  const advance = (ms: number) => {
    now += ms;
    queue.sweep();
  };
  return { queue, submit, advance };
};

// Promise callbacks run as microtasks.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('JobQueue', () => {
  it('leases a queued job with its window, then completes it once', () => {
    const { queue, submit } = setup();
    const { id, result } = submit('a');
    expect(result).toEqual({ ok: true, state: 'queued' });

    expect(queue.hasQueued()).toBe(true);
    const leased = queue.leaseNow('w1', ['kokoro']);
    expect(leased).toMatchObject({ jobId: id, lang: 'en' });
    expect(queue.hasQueued()).toBe(false);
    expect(leased?.segments).toHaveLength(1);
    expect(queue.job(leased!.lease)).toEqual(leased);
    expect(queue.status(id, 'a')).toBe('leased');

    expect(queue.complete(leased!.lease)).toEqual({ userId: 'a', plan: 'pro' });
    expect(queue.complete(leased!.lease)).toBeNull();
    expect(queue.status(id, 'a')).toBe('done');
    expect(queue.job(leased!.lease)).toBeNull();
  });

  it('returns the existing job when the same window is submitted again', () => {
    const { queue, submit } = setup();
    submit('a', { id: 'same' });
    expect(submit('a', { id: 'same' }).result).toEqual({ ok: true, state: 'queued' });
    queue.leaseNow('w1', ['kokoro']);
    expect(queue.leaseNow('w1', ['kokoro'])).toBeNull();
  });

  it('hands each worker only jobs whose engines it runs', () => {
    const { queue, submit } = setup();
    const { id } = submit('a', { engines: ['omnivoice'] });
    expect(queue.leaseNow('w1', ['kokoro'])).toBeNull();
    expect(queue.leaseNow('w2', ['kokoro', 'omnivoice'])?.jobId).toBe(id);
  });

  it('leases to a worker that runs every engine under a lease named up front', () => {
    const { queue, submit } = setup();
    submit('a', { engines: ['omnivoice'] });
    expect(queue.leaseNow('bridge', null, 'named')?.lease).toBe('named');
    expect(queue.isLeaseLive('named')).toBe(true);
  });

  it('serves the user served least recently first, several jobs when alone', () => {
    const { queue, submit } = setup();
    const a1 = submit('a').id;
    const a2 = submit('a').id;
    const b1 = submit('b').id;
    expect(queue.leaseNow('w1', ['kokoro'])?.jobId).toBe(a1);
    // a asked first, but was just served.
    expect(queue.leaseNow('w2', ['kokoro'])?.jobId).toBe(b1);
    // Nobody else waits: a's next job runs beside its first.
    expect(queue.leaseNow('w3', ['kokoro'])?.jobId).toBe(a2);
  });

  it('refuses a user with too many queued jobs or not enough quota left', () => {
    const { submit } = setup(2);
    submit('a');
    submit('a');
    expect(submit('a').result).toEqual({ ok: false, error: 'BUSY' });
    // 12 chars per job: an unfinished job plus this one need 24.
    expect(submit('b', { quotaLeft: 20 }).result).toEqual({ ok: true, state: 'queued' });
    expect(submit('b', { quotaLeft: 20 }).result).toEqual({
      ok: false,
      error: 'DAILY_QUOTA_EXCEEDED',
    });
  });

  it('wakes a waiting worker when a job arrives, or gives up at the deadline', async () => {
    const { queue, submit, advance } = setup();
    let got: unknown = 'pending';
    void queue.lease('w1', ['kokoro'], 25_000).then((job) => (got = job));
    await flush();
    expect(got).toBe('pending');
    const { id } = submit('a');
    await flush();
    expect(got).toMatchObject({ jobId: id });

    let idle: unknown = 'pending';
    void queue.lease('w1', ['kokoro'], 25_000).then((job) => (idle = job));
    expect(queue.nextDeadline()).toBe(1_000 + 25_000);
    advance(25_000);
    await flush();
    expect(idle).toBeNull();
  });

  it('requeues a job whose lease ran out, and fails it after the last attempt', () => {
    const { queue, submit, advance } = setup();
    const { id } = submit('a');
    const first = queue.leaseNow('w1', ['kokoro'])!;
    advance(LEASE_MS / 2);
    expect(queue.heartbeat(first.lease)).toBe(true);
    advance(LEASE_MS - 1);
    expect(queue.status(id, 'a')).toBe('leased');
    advance(1);
    expect(queue.status(id, 'a')).toBe('queued');
    expect(queue.heartbeat(first.lease)).toBe(false);
    expect(queue.complete(first.lease)).toBeNull();

    queue.leaseNow('w2', ['kokoro']);
    advance(LEASE_MS);
    expect(queue.status(id, 'a')).toBe('failed');
  });

  it('cancels a job for its owner only and stops its worker', () => {
    const { queue, submit } = setup();
    const { id } = submit('a');
    const leased = queue.leaseNow('w1', ['kokoro'])!;
    expect(queue.cancel(id, 'b')).toBe(false);
    expect(queue.cancel(id, 'a')).toBe(true);
    expect(queue.status(id, 'a')).toBe('cancelled');
    expect(queue.heartbeat(leased.lease)).toBe(false);
    expect(queue.complete(leased.lease)).toBeNull();
    // A cancelled job submitted again runs again.
    expect(submit('a', { id }).result).toEqual({ ok: true, state: 'queued' });
  });

  it('answers a waiting app when its job ends or at the deadline', async () => {
    const { queue, submit, advance } = setup();
    const { id } = submit('a');
    let state: unknown = 'pending';
    void queue.wait(id, 'a', 25_000).then((s) => (state = s));
    const leased = queue.leaseNow('w1', ['kokoro'])!;
    await flush();
    expect(state).toBe('pending');
    queue.complete(leased.lease);
    await flush();
    expect(state).toBe('done');

    const other = submit('a').id;
    let timedOut: unknown = 'pending';
    void queue.wait(other, 'a', 25_000).then((s) => (timedOut = s));
    advance(25_000);
    await flush();
    expect(timedOut).toBe('queued');
    await expect(queue.wait('missing', 'a', 25_000)).resolves.toBeNull();
  });

  it('keeps no book text once a job ends and forgets it after the retention', () => {
    const { queue, submit, advance } = setup();
    const { id } = submit('a');
    queue.complete(queue.leaseNow('w1', ['kokoro'])!.lease);
    const { put } = queue.takeChanges();
    expect(put.find((job) => job.id === id)?.segments).toEqual([]);

    advance(RETAIN_MS);
    expect(queue.status(id, 'a')).toBeNull();
    expect(queue.takeChanges().deleted).toEqual([id]);
  });

  it('forgets a fetched job for its owner', () => {
    const { queue, submit } = setup();
    const { id } = submit('a');
    queue.forget(id, 'b');
    expect(queue.status(id, 'a')).toBe('queued');
    queue.forget(id, 'a');
    expect(queue.status(id, 'a')).toBeNull();
  });

  it('restores persisted jobs, leases included', () => {
    const first = setup();
    const { id } = first.submit('a');
    const leased = first.queue.leaseNow('w1', ['kokoro'])!;
    const { put } = first.queue.takeChanges();

    const { queue } = setup();
    queue.restore(put);
    expect(queue.status(id, 'a')).toBe('leased');
    expect(queue.isLeaseLive(leased.lease)).toBe(true);
    expect(queue.complete(leased.lease)).toEqual({ userId: 'a', plan: 'pro' });
  });

  it('reports the characters of the unfinished jobs of a user', () => {
    const { queue, submit } = setup();
    submit('a');
    submit('a');
    submit('b');
    queue.complete(queue.leaseNow('w1', ['kokoro'])!.lease);
    // Each job is 12 chars; a's first job is done.
    expect(queue.pendingChars('a')).toBe(12);
    expect(queue.pendingChars('b')).toBe(12);
    expect(queue.pendingChars('c')).toBe(0);
  });
});
