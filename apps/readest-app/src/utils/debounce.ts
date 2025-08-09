interface DebounceOptions {
  emitLast?: boolean;
}

/**
 * Debounces a function by waiting `delay` ms after the last call before executing it.
 * If `emitLast` is false, it cancels the call instead of delaying it.
 *
 * @returns A debounced function with additional `flush` and `cancel` methods.
 */
export const debounce = <T extends (...args: Parameters<T>) => void | Promise<void>>(
  func: T,
  delay: number,
  options: DebounceOptions = { emitLast: true },
): ((...args: Parameters<T>) => void) & { flush: () => void; cancel: () => void } => {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Parameters<T> | null = null;

  const debounced = (...args: Parameters<T>): void => {
    lastArgs = args;
    if (timeout) {
      clearTimeout(timeout);
    }

    if (options.emitLast) {
      timeout = setTimeout(() => {
        if (lastArgs) {
          func(...(lastArgs as Parameters<T>));
          lastArgs = null;
        }
        timeout = null;
      }, delay);
    } else {
      timeout = setTimeout(() => {
        func(...args);
        timeout = null;
      }, delay);
    }
  };

  /**
   * Immediately executes the last pending debounced function call.
   */
  debounced.flush = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
      if (lastArgs) {
        func(...(lastArgs as Parameters<T>));
        lastArgs = null;
      }
    }
  };

  /**
   * Cancels the pending debounced function call.
   */
  debounced.cancel = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
      lastArgs = null;
    }
  };

  return debounced;
};
