import { ViewSettings } from '@/types/book';
import { useEffect, useState } from 'react';

// This hook allows you to inject custom CSS into the reader UI.
// Note that the book content is rendered in an iframe, so UI CSS won't affect book rendering.
export const useUICSS = (viewSettings: ViewSettings) => {
  const [styleElement, setStyleElement] = useState<HTMLStyleElement | null>(null);

  useEffect(() => {
    if (!viewSettings) return;
    if (styleElement) {
      styleElement.remove();
    }

    const newStyleEl = document.createElement('style');
    newStyleEl.textContent = viewSettings.userStylesheet;
    document.head.appendChild(newStyleEl);
    setStyleElement(newStyleEl);

    return () => {
      newStyleEl.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewSettings]);
};
