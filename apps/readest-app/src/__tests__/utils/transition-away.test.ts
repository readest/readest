import { afterEach, describe, expect, it, vi } from 'vitest';
import { transitionAway } from '@/utils/viewTransition';

type VTDocument = { startViewTransition?: (update: () => Promise<void>) => unknown };
const doc = document as unknown as VTDocument;

afterEach(() => {
  delete doc.startViewTransition;
  document.documentElement.removeAttribute('data-nav-direction');
});

describe('transitionAway', () => {
  it('captures the page before leaving and holds it until the destination is ready', async () => {
    const order: string[] = [];
    let arrived = false;
    doc.startViewTransition = (update) => {
      order.push('snapshot');
      const updateCallbackDone = update();
      return { updateCallbackDone, ready: Promise.resolve(), finished: updateCallbackDone };
    };
    const done = transitionAway(
      async () => {
        order.push('leave');
        setTimeout(() => (arrived = true), 50);
      },
      () => arrived,
      'back',
    );
    expect(document.documentElement.getAttribute('data-nav-direction')).toBe('back');
    await done;
    expect(order).toEqual(['snapshot', 'leave']);
    expect(arrived).toBe(true);
    // The direction is per transition, so a later route change gets its own.
    expect(document.documentElement.hasAttribute('data-nav-direction')).toBe(false);
  });

  it('stops waiting for a destination that never reports ready', async () => {
    doc.startViewTransition = (update) => {
      const updateCallbackDone = update();
      return { updateCallbackDone, ready: Promise.resolve(), finished: updateCallbackDone };
    };
    const start = Date.now();
    await transitionAway(
      async () => {},
      () => false,
      'back',
      100,
    );
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it('surfaces a failed leave without an unhandled finished rejection', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    doc.startViewTransition = (update) => {
      const updateCallbackDone = update();
      // Like the engine: a separate `finished` that rejects when the update fails.
      const finished = updateCallbackDone.then(() => undefined);
      return { updateCallbackDone, ready: Promise.resolve(), finished };
    };
    await expect(
      transitionAway(
        async () => {
          throw new Error('close failed');
        },
        () => true,
        'back',
      ),
    ).rejects.toThrow('close failed');
    await new Promise((r) => setTimeout(r, 0));
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    expect(document.documentElement.hasAttribute('data-nav-direction')).toBe(false);
  });

  it('just leaves when the engine has no view transitions', async () => {
    const leave = vi.fn(async () => {});
    await transitionAway(leave, () => true, 'back');
    expect(leave).toHaveBeenCalledOnce();
  });
});
