const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Bucket = { remaining: number; resetSec: number };

/** Parses `"Free";r=8;t=42, "daily";r=4231;t=51234` into the per-minute and daily buckets. */
export const parseRateLimit = (header: string | null | undefined) => {
  const out: { minute?: Bucket; daily?: Bucket } = {};
  for (const entry of (header ?? '').split(',')) {
    const name = entry.match(/^\s*"([^"]*)"/)?.[1];
    const remaining = entry.match(/;\s*r=(\d+)/)?.[1];
    const resetSec = entry.match(/;\s*t=(\d+)/)?.[1];
    if (!name || remaining === undefined || resetSec === undefined) continue;
    out[name === 'daily' ? 'daily' : 'minute'] = {
      remaining: Number(remaining),
      resetSec: Number(resetSec),
    };
  }
  return out;
};

/** Retry-After in seconds → ms, or null when absent/invalid. */
export const parseRetryAfterMs = (header: string | null | undefined) => {
  const sec = header ? Number(header) : NaN;
  return Number.isFinite(sec) && sec >= 0 ? sec * 1000 : null;
};

/** Longest block a request will wait out; anything longer (e.g. the daily quota) fails fast. */
export const MAX_WAIT_MS = 60_000;
// The per-minute quota refills at one request per second.
const REFILL_MS = 1000;
// A request may carry at most the burst limit's worth of operations; assume the
// free plan's until a response reports the bucket.
const DEFAULT_BATCH_SIZE = 10;

/** Delays requests only once the server reports an empty bucket, so the burst budget is usable. */
export class RateLimitGate {
  private blockedUntil = 0;
  private remaining = 0; // 0 until a response reports it
  private queue: Promise<void> = Promise.resolve();

  blockFor(ms: number) {
    this.blockedUntil = Math.max(this.blockedUntil, Date.now() + ms);
  }

  /**
   * Operations that fit in one request: each counts against the bucket, so a
   * batch larger than the remaining quota would be rejected. An empty bucket
   * refills while the gate waits, so it doesn't shrink the batch.
   */
  get batchSize() {
    return this.remaining || DEFAULT_BATCH_SIZE;
  }

  /** Resolves when a request may be sent; waiters leave a block one at a time. */
  wait() {
    const turn = this.queue.then(() => this.pass());
    this.queue = turn.catch(() => {});
    return turn;
  }

  private async pass() {
    let blocked = false;
    while (Date.now() < this.blockedUntil) {
      if (this.blockedUntil - Date.now() > MAX_WAIT_MS) {
        throw new Error('Hardcover rate limit reached, try again later');
      }
      blocked = true;
      await sleep(this.blockedUntil - Date.now());
    }
    if (blocked) this.blockFor(REFILL_MS);
  }

  /** Records the response's rate-limit headers, blocking on an empty bucket. */
  update(headers: Headers) {
    const { minute, daily } = parseRateLimit(headers.get('RateLimit'));
    if (daily?.remaining === 0) this.blockFor(daily.resetSec * 1000);
    if (minute || daily) {
      this.remaining = Math.min(minute?.remaining ?? Infinity, daily?.remaining ?? Infinity);
    }
    if (minute?.remaining === 0) this.blockFor(minute.resetSec * 1000);
  }
}

// Shared per token so concurrent clients (e.g. progress and notes pushes) pace together.
const gates = new Map<string, RateLimitGate>();

export const getRateLimitGate = (token: string) => {
  let gate = gates.get(token);
  if (!gate) gates.set(token, (gate = new RateLimitGate()));
  return gate;
};
