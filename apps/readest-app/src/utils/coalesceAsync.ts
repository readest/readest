/**
 * Serializes overlapping calls: one made mid-run coalesces with any others into a
 * single rerun with the latest arguments, and its promise settles when that rerun
 * finishes (even if it throws).
 */
export function coalesceAsync<Args extends unknown[]>(
  fn: (...args: Args) => Promise<void>,
): (...args: Args) => Promise<void> {
  let running = false;
  let pending: { args: Args; promise: Promise<void>; resolve: () => void } | null = null;

  const run = async (...args: Args): Promise<void> => {
    if (running) {
      if (pending) {
        pending.args = args;
      } else {
        let resolve!: () => void;
        const promise = new Promise<void>((r) => (resolve = r));
        pending = { args, promise, resolve };
      }
      return pending.promise;
    }
    running = true;
    try {
      await fn(...args);
    } finally {
      running = false;
      const next = pending;
      pending = null;
      if (next) {
        try {
          await run(...next.args);
        } finally {
          next.resolve();
        }
      }
    }
  };

  return run;
}
