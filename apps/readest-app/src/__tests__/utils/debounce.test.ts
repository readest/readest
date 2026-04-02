import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { debounce } from '@/utils/debounce';

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // Basic debounce behavior (emitLast: true, default)
  // -----------------------------------------------------------------------
  describe('emitLast: true (default)', () => {
    it('does not call the function immediately', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);
      debounced();
      expect(fn).not.toHaveBeenCalled();
    });

    it('calls the function after the delay', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);
      debounced('a');
      vi.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledOnce();
      expect(fn).toHaveBeenCalledWith('a');
    });

    it('resets the timer on subsequent calls and uses the last args', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);
      debounced('first');
      vi.advanceTimersByTime(50);
      debounced('second');
      vi.advanceTimersByTime(50);
      // Only 50ms have passed since second call, should not fire yet
      expect(fn).not.toHaveBeenCalled();
      vi.advanceTimersByTime(50);
      expect(fn).toHaveBeenCalledOnce();
      expect(fn).toHaveBeenCalledWith('second');
    });

    it('calls function only once when invoked many times within delay', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);
      for (let i = 0; i < 10; i++) {
        debounced(i);
      }
      vi.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledOnce();
      expect(fn).toHaveBeenCalledWith(9);
    });
  });

  // -----------------------------------------------------------------------
  // emitLast: false
  // -----------------------------------------------------------------------
  describe('emitLast: false', () => {
    it('calls function with the args from each call (not the last)', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100, { emitLast: false });
      debounced('first');
      vi.advanceTimersByTime(50);
      debounced('second');
      vi.advanceTimersByTime(100);
      // With emitLast: false, each call sets a new timeout with its own args
      expect(fn).toHaveBeenCalledOnce();
      expect(fn).toHaveBeenCalledWith('second');
    });

    it('fires the original args, not the latest, after delay', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100, { emitLast: false });
      debounced('only');
      vi.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledWith('only');
    });
  });

  // -----------------------------------------------------------------------
  // flush
  // -----------------------------------------------------------------------
  describe('flush', () => {
    it('immediately invokes the pending call with latest args', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);
      debounced('a');
      debounced('b');
      debounced.flush();
      expect(fn).toHaveBeenCalledOnce();
      expect(fn).toHaveBeenCalledWith('b');
    });

    it('clears the pending timer after flushing', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);
      debounced('a');
      debounced.flush();
      vi.advanceTimersByTime(200);
      // Should not fire again after flush
      expect(fn).toHaveBeenCalledOnce();
    });

    it('does nothing when there is no pending call', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);
      debounced.flush();
      expect(fn).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // cancel
  // -----------------------------------------------------------------------
  describe('cancel', () => {
    it('prevents the pending call from firing', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);
      debounced('a');
      debounced.cancel();
      vi.advanceTimersByTime(200);
      expect(fn).not.toHaveBeenCalled();
    });

    it('clears lastArgs so a subsequent flush does nothing', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);
      debounced('a');
      debounced.cancel();
      debounced.flush();
      expect(fn).not.toHaveBeenCalled();
    });

    it('does nothing when there is no pending call', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);
      debounced.cancel(); // should not throw
      expect(fn).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------
  describe('edge cases', () => {
    it('works with zero delay', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 0);
      debounced('instant');
      vi.advanceTimersByTime(0);
      expect(fn).toHaveBeenCalledOnce();
      expect(fn).toHaveBeenCalledWith('instant');
    });

    it('works with multiple arguments', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 50);
      debounced('a', 'b', 'c');
      vi.advanceTimersByTime(50);
      expect(fn).toHaveBeenCalledWith('a', 'b', 'c');
    });

    it('can be called again after the debounced function fires', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);
      debounced('first');
      vi.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledOnce();

      debounced('second');
      vi.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledTimes(2);
      expect(fn).toHaveBeenLastCalledWith('second');
    });

    it('handles async functions as the debounced callback', () => {
      const fn = vi.fn(async () => {
        /* noop */
      });
      const debounced = debounce(fn, 50);
      debounced();
      vi.advanceTimersByTime(50);
      expect(fn).toHaveBeenCalledOnce();
    });
  });
});
