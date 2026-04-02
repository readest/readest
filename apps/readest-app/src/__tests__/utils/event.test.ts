import { describe, it, expect, vi } from 'vitest';

// We need to import the singleton, but also be able to test a fresh instance.
// The module exports a singleton `eventDispatcher`. Since the class is not
// exported, we test through the singleton and reset between tests.

import { eventDispatcher } from '@/utils/event';

describe('EventDispatcher', () => {
  // -----------------------------------------------------------------------
  // Async listeners (on / off / dispatch)
  // -----------------------------------------------------------------------
  describe('async listeners', () => {
    it('registers and dispatches an async listener', async () => {
      const fn = vi.fn();
      eventDispatcher.on('test-event', fn);
      await eventDispatcher.dispatch('test-event', { foo: 'bar' });
      expect(fn).toHaveBeenCalledOnce();
      expect(fn.mock.calls[0]![0]).toBeInstanceOf(CustomEvent);
      expect(fn.mock.calls[0]![0].detail).toEqual({ foo: 'bar' });
      eventDispatcher.off('test-event', fn);
    });

    it('dispatches to multiple listeners in order', async () => {
      const order: number[] = [];
      const fn1 = vi.fn(() => {
        order.push(1);
      });
      const fn2 = vi.fn(() => {
        order.push(2);
      });
      eventDispatcher.on('multi', fn1);
      eventDispatcher.on('multi', fn2);
      await eventDispatcher.dispatch('multi');
      expect(order).toEqual([1, 2]);
      eventDispatcher.off('multi', fn1);
      eventDispatcher.off('multi', fn2);
    });

    it('removes a listener with off()', async () => {
      const fn = vi.fn();
      eventDispatcher.on('rm-test', fn);
      eventDispatcher.off('rm-test', fn);
      await eventDispatcher.dispatch('rm-test');
      expect(fn).not.toHaveBeenCalled();
    });

    it('off() on non-existent event does not throw', () => {
      const fn = vi.fn();
      expect(() => eventDispatcher.off('nonexistent', fn)).not.toThrow();
    });

    it('dispatch on event with no listeners does not throw', async () => {
      await expect(eventDispatcher.dispatch('no-listeners', { x: 1 })).resolves.toBeUndefined();
    });

    it('dispatch with no detail sends undefined as detail argument', async () => {
      const fn = vi.fn();
      eventDispatcher.on('no-detail', fn);
      await eventDispatcher.dispatch('no-detail');
      // CustomEvent({ detail: undefined }) results in detail being null per spec
      expect(fn.mock.calls[0]![0].detail).toBeNull();
      eventDispatcher.off('no-detail', fn);
    });

    it('awaits async listeners sequentially', async () => {
      const order: string[] = [];
      const slowFn = vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 10));
        order.push('slow');
      });
      const fastFn = vi.fn(() => {
        order.push('fast');
      });
      eventDispatcher.on('seq', slowFn);
      eventDispatcher.on('seq', fastFn);
      await eventDispatcher.dispatch('seq');
      // slow should complete before fast starts because dispatch awaits each
      expect(order).toEqual(['slow', 'fast']);
      eventDispatcher.off('seq', slowFn);
      eventDispatcher.off('seq', fastFn);
    });
  });

  // -----------------------------------------------------------------------
  // Sync listeners (onSync / offSync / dispatchSync)
  // -----------------------------------------------------------------------
  describe('sync listeners', () => {
    it('registers and dispatches a sync listener', () => {
      const fn = vi.fn((_event: CustomEvent) => false);
      eventDispatcher.onSync('sync-test', fn);
      eventDispatcher.dispatchSync('sync-test', 42);
      expect(fn).toHaveBeenCalledOnce();
      expect(fn.mock.calls[0]![0].detail).toBe(42);
      eventDispatcher.offSync('sync-test', fn);
    });

    it('returns true when a listener consumes the event', () => {
      const consumer = vi.fn(() => true);
      eventDispatcher.onSync('consume', consumer);
      const result = eventDispatcher.dispatchSync('consume');
      expect(result).toBe(true);
      eventDispatcher.offSync('consume', consumer);
    });

    it('returns false when no listener consumes the event', () => {
      const ignorer = vi.fn(() => false);
      eventDispatcher.onSync('ignore', ignorer);
      const result = eventDispatcher.dispatchSync('ignore');
      expect(result).toBe(false);
      eventDispatcher.offSync('ignore', ignorer);
    });

    it('stops at the first consumer (reverse order)', () => {
      const fn1 = vi.fn(() => true);
      const fn2 = vi.fn(() => false);
      // fn1 is registered first, fn2 second. Dispatch iterates in reverse.
      eventDispatcher.onSync('stop-early', fn1);
      eventDispatcher.onSync('stop-early', fn2);

      const result = eventDispatcher.dispatchSync('stop-early');

      // fn2 (last registered) is called first in reverse, returns false
      // then fn1 is called, returns true (consumed)
      expect(fn2).toHaveBeenCalledOnce();
      expect(fn1).toHaveBeenCalledOnce();
      expect(result).toBe(true);

      eventDispatcher.offSync('stop-early', fn1);
      eventDispatcher.offSync('stop-early', fn2);
    });

    it('stops at consumer and does not call earlier listeners', () => {
      const earlyFn = vi.fn(() => true);
      const lateFn = vi.fn(() => true);
      eventDispatcher.onSync('stop', earlyFn);
      eventDispatcher.onSync('stop', lateFn);

      eventDispatcher.dispatchSync('stop');

      // lateFn (last registered) is called first in reverse, returns true -> stop
      expect(lateFn).toHaveBeenCalledOnce();
      expect(earlyFn).not.toHaveBeenCalled();

      eventDispatcher.offSync('stop', earlyFn);
      eventDispatcher.offSync('stop', lateFn);
    });

    it('removes a sync listener with offSync()', () => {
      const fn = vi.fn(() => false);
      eventDispatcher.onSync('off-sync', fn);
      eventDispatcher.offSync('off-sync', fn);
      eventDispatcher.dispatchSync('off-sync');
      expect(fn).not.toHaveBeenCalled();
    });

    it('offSync on non-existent event does not throw', () => {
      const fn = vi.fn(() => false);
      expect(() => eventDispatcher.offSync('nope', fn)).not.toThrow();
    });

    it('dispatchSync on event with no listeners returns false', () => {
      expect(eventDispatcher.dispatchSync('nobody-listens')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Isolation between event names
  // -----------------------------------------------------------------------
  describe('event isolation', () => {
    it('does not cross-fire between different event names', async () => {
      const fn1 = vi.fn();
      const fn2 = vi.fn();
      eventDispatcher.on('event-a', fn1);
      eventDispatcher.on('event-b', fn2);
      await eventDispatcher.dispatch('event-a');
      expect(fn1).toHaveBeenCalledOnce();
      expect(fn2).not.toHaveBeenCalled();
      eventDispatcher.off('event-a', fn1);
      eventDispatcher.off('event-b', fn2);
    });

    it('sync and async listeners with same event name are independent', async () => {
      const asyncFn = vi.fn();
      const syncFn = vi.fn(() => false);
      eventDispatcher.on('shared-name', asyncFn);
      eventDispatcher.onSync('shared-name', syncFn);

      await eventDispatcher.dispatch('shared-name');
      expect(asyncFn).toHaveBeenCalledOnce();
      expect(syncFn).not.toHaveBeenCalled();

      eventDispatcher.dispatchSync('shared-name');
      expect(syncFn).toHaveBeenCalledOnce();
      expect(asyncFn).toHaveBeenCalledOnce(); // still only once

      eventDispatcher.off('shared-name', asyncFn);
      eventDispatcher.offSync('shared-name', syncFn);
    });
  });
});
