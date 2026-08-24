import { describe, expect, it, vi } from 'vitest';

import { XRayScheduler, type XRayScheduledUpdate } from '@/services/ai/xray/XRayScheduler';
import type { BookDoc } from '@/libs/document';

const request = (currentCfi: string): XRayScheduledUpdate => ({
  bookHash: 'book-a',
  currentCfi,
  bookDoc: {} as BookDoc,
});

describe('XRayScheduler', () => {
  it('coalesces rapid progress updates to the latest CFI', async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockResolvedValue(undefined);
    const scheduler = new XRayScheduler(run, { delayMs: 100 });

    scheduler.schedule(request('cfi-1'));
    scheduler.schedule(request('cfi-2'));
    scheduler.schedule(request('cfi-3'));
    await vi.advanceTimersByTimeAsync(100);

    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]![0].currentCfi).toBe('cfi-3');
    scheduler.dispose();
    vi.useRealTimers();
  });

  it('serializes an update scheduled while another update is running', async () => {
    let releaseFirst: (() => void) | undefined;
    let active = 0;
    let maxActive = 0;
    const run = vi.fn(async ({ currentCfi }: XRayScheduledUpdate) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (currentCfi === 'cfi-1') {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      }
      active -= 1;
    });
    const scheduler = new XRayScheduler(run, { delayMs: 0 });

    scheduler.schedule(request('cfi-1'));
    const firstRun = scheduler.flush();
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    scheduler.schedule(request('cfi-2'));
    releaseFirst?.();
    await firstRun;

    expect(run.mock.calls.map(([item]) => item.currentCfi)).toEqual(['cfi-1', 'cfi-2']);
    expect(maxActive).toBe(1);
    scheduler.dispose();
  });
});
