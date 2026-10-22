import { useCallback, useEffect, useRef } from 'react';

// When a window is activated again, the webview hands focus back to the element
// that had it: `focus` fires on the window and then, in the same task, on that
// element. The header and footer reveal themselves on focus for keyboard users,
// but a button clicked before the switch keeps focus after its bar hides, so
// that restore would bring the bar back with the pointer elsewhere and no
// mouseleave to hide it again (#6940). Returns whether a focus event is that
// restore.
export const useWindowFocusRestore = () => {
  const restoring = useRef(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // `focus` doesn't bubble, so only the window's own reaches this listener.
    const onWindowFocus = () => {
      restoring.current = true;
      clearTimeout(timer);
      timer = setTimeout(() => {
        restoring.current = false;
      });
    };
    window.addEventListener('focus', onWindowFocus);
    return () => {
      window.removeEventListener('focus', onWindowFocus);
      clearTimeout(timer);
    };
  }, []);

  return useCallback(() => restoring.current, []);
};
