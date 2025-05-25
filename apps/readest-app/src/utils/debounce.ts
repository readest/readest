interface DebounceOptions {
  emitLast?: boolean;
}

/**
 * Debounces a function by waiting `delay` ms after the last call before executing it.
 * If `emitLast` is false, it cancels the call instead of delaying it.
 */
export const debounce = <T extends (...args: Parameters<T>) => void | Promise<void>>(
  func: T,
  delay: number,
  options: DebounceOptions = { emitLast: true },
): ((...args: Parameters<T>) => void) => {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Parameters<T> | null = null;

  return (...args: Parameters<T>): void => {
    if (timeout) {
      clearTimeout(timeout);
    }

    if (options.emitLast) {
      lastArgs = args;
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
};
