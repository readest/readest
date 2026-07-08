import { useCallback, useEffect, useRef } from 'react';

/**
 * Hover-with-intent trigger: `start()` fires `onHover` only after the pointer
 * has dwelled for `delayMs`; `cancel()` (call it on mouseleave) discards a
 * pending trigger. Prevents hover-revealed chrome from popping up while the
 * pointer merely travels across its trigger area toward something else.
 */
export const useHoverIntent = (onHover: () => void, delayMs = 300) => {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onHoverRef = useRef(onHover);
  onHoverRef.current = onHover;

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    cancel();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      onHoverRef.current();
    }, delayMs);
  }, [cancel, delayMs]);

  useEffect(() => cancel, [cancel]);

  return { start, cancel };
};
