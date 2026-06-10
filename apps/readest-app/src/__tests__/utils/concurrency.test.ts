import { describe, expect, test } from 'vitest';
import { runWithConcurrency } from '@/utils/concurrency';

/**
 * Tests for the shared bounded-concurrency runner used by nav build,
 * embedded-nav enrichment, and OPDS auto-download. Three properties matter
 * to those callers and are pinned down here:
 *
 *   1. In-flight task count never exceeds the requested cap. The whole
 *      reason this primitive exists is to stop nav build from saturating
 *      the Tauri IPC bridge / fd pool, so a regression here would silently
 *      reintroduce the "Cannot close a ERRORED writable stream" failure
 *      mode on Android.
 *   2. Output is positionally aligned with input even when tasks complete
 *      out of order. OPDS callers index into the result array assuming
 *      `results[i]` is the outcome of `items[i]`.
 *   3. A throwing task does not abort sibling tasks — failures are
 *      surfaced as `{ item, error }` outcomes alongside successes. This
 *      is what lets nav build keep going when one section's inflate
 *      genuinely fails.
 */

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('runWithConcurrency', () => {
  test('caps simultaneous in-flight tasks at the requested concurrency', async () => {
    const N = 30;
    const CAP = 4;
    let active = 0;
    let peak = 0;

    await runWithConcurrency(
      Array.from({ length: N }, (_, i) => i),
      CAP,
      async () => {
        active += 1;
        if (active > peak) peak = active;
        // A short await is enough to exercise the bound: every worker
        // hits this point once before it has a chance to release, so
        // peak observably reaches `CAP` (and never exceeds it).
        await wait(5);
        active -= 1;
      },
    );

    expect(peak).toBe(CAP);
    expect(active).toBe(0);
  });

  test('preserves positional alignment with the input array', async () => {
    const items = Array.from({ length: 10 }, (_, i) => i);

    // Reverse the natural completion order: large indices finish first,
    // small indices last. If the runner appended results in completion
    // order, the assertion below would fail.
    const outcomes = await runWithConcurrency(items, 4, async (i) => {
      await wait((10 - i) * 2);
      return i * 10;
    });

    expect(outcomes).toHaveLength(items.length);
    outcomes.forEach((o, i) => {
      expect(o.item).toBe(items[i]);
      expect('result' in o ? o.result : null).toBe(i * 10);
    });
  });

  test('isolates failures so siblings still run to completion', async () => {
    const items = ['ok-1', 'fail', 'ok-2'];

    const outcomes = await runWithConcurrency(items, 2, async (item) => {
      if (item === 'fail') throw new Error('boom');
      return item.toUpperCase();
    });

    expect(outcomes.map((o) => ('error' in o ? 'fail' : o.result))).toEqual([
      'OK-1',
      'fail',
      'OK-2',
    ]);
    const failed = outcomes.find((o) => 'error' in o);
    expect(failed?.error).toBeInstanceOf(Error);
    expect((failed?.error as Error).message).toBe('boom');
  });

  test('returns immediately on an empty input', async () => {
    const outcomes = await runWithConcurrency<number, number>([], 4, async (x) => x);
    expect(outcomes).toEqual([]);
  });

  test('normalises non-positive concurrency to a single worker', async () => {
    let peak = 0;
    let active = 0;
    await runWithConcurrency([1, 2, 3, 4], 0, async () => {
      active += 1;
      if (active > peak) peak = active;
      await wait(2);
      active -= 1;
    });
    expect(peak).toBe(1);
  });
});
