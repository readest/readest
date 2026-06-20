/**
 * Generic bounded-concurrency runner.
 *
 * Spawns up to `concurrency` workers that pull from a shared cursor over
 * `items` and invoke `fn` on each. Each worker awaits its own task before
 * pulling the next, so at any instant the in-flight count is bounded by
 * `min(concurrency, items.length)` — the natural primitive for "I have a
 * list of N independent async tasks and want to fan them out to a fixed
 * pool" without pulling in `p-limit`.
 *
 * Why not throw on the first failure (Promise.all semantics):
 *   - Several call sites (OPDS sync, nav build) treat the per-item
 *     failure as a recoverable, individually-loggable event. A single
 *     bad EPUB section, or a single 503'd OPDS download, must not
 *     abort the rest of the batch.
 *   - The shape `{ item, result } | { item, error }` lets callers
 *     post-process success and failure separately without an extra
 *     try/catch around every worker invocation.
 *
 * Behavioural guarantees:
 *   - `results` is positionally aligned with `items` (results[i] is the
 *     outcome of items[i]), even though tasks complete out of order.
 *   - `concurrency <= 0` is normalised to a single worker so callers
 *     don't have to special-case empty pools.
 *   - When `items` is empty the function resolves immediately with `[]`
 *     without spawning a worker.
 */
export interface ConcurrencyTaskSuccess<T, R> {
  item: T;
  result: R;
}

export interface ConcurrencyTaskFailure<T> {
  item: T;
  error: unknown;
}

export type ConcurrencyTaskOutcome<T, R> = ConcurrencyTaskSuccess<T, R> | ConcurrencyTaskFailure<T>;

export async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<ConcurrencyTaskOutcome<T, R>[]> {
  if (items.length === 0) return [];
  const effective = Math.max(1, Math.min(concurrency, items.length));
  const results: ConcurrencyTaskOutcome<T, R>[] = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index++;
      const item = items[currentIndex]!;
      try {
        const result = await fn(item);
        results[currentIndex] = { item, result };
      } catch (error) {
        results[currentIndex] = { item, error };
      }
    }
  }

  await Promise.all(Array.from({ length: effective }, () => worker()));
  return results;
}
