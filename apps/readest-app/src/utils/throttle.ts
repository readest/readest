export const throttle = <T extends (...args: Parameters<T>) => void | Promise<void>>(
  func: T,
  delay: number,
): ((...args: Parameters<T>) => void) => {
  let lastCall = 0;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Parameters<T> | null = null;

  return (...args: Parameters<T>): void => {
    const now = Date.now();
    const remaining = delay - (now - lastCall);

    const callFunc = () => {
      lastCall = Date.now();
      timeout = null;
      func(...args);
    };

    if (remaining <= 0) {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      callFunc();
    } else {
      lastArgs = args;
      if (!timeout) {
        timeout = setTimeout(() => {
          timeout = null;
          if (lastArgs) {
            func(...(lastArgs as Parameters<T>));
            lastArgs = null;
          }
        }, remaining);
      }
    }
  };
};
