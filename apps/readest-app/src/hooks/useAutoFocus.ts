import { useEffect, useRef } from 'react';

interface UseAutoFocusOptions {
  ref?: React.RefObject<HTMLElement | null>;
  delay?: number;
  condition?: boolean;
  preventScroll?: boolean;
}

export const useAutoFocus = <T extends HTMLElement = HTMLDivElement>(
  options: UseAutoFocusOptions = {},
) => {
  const { delay = 0, condition = true, preventScroll = false, ref } = options;
  const localRef = useRef<T>(null);
  const focusRef = ref || localRef;

  useEffect(() => {
    if (condition && focusRef.current) {
      const focusElement = () => {
        focusRef.current?.focus({ preventScroll });
      };

      if (delay > 0) {
        const timer = setTimeout(focusElement, delay);
        return () => clearTimeout(timer);
      } else {
        focusElement();
      }
    }
    return;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [condition, delay, preventScroll]);

  return focusRef as React.RefObject<T>;
};
