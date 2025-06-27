import { useEffect, useState } from 'react';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';

// This hook allows you to inject custom CSS into the reader UI.
// Note that the book content is rendered in an iframe, so UI CSS won't affect book rendering.
export const useUICSS = (bookKey?: string) => {
  const { settings } = useSettingsStore();
  const { getViewSettings } = useReaderStore();
  const viewSettings = getViewSettings(bookKey || '');
  const [styleElement, setStyleElement] = useState<HTMLStyleElement | null>(null);

  useEffect(() => {
    if (styleElement) {
      styleElement.remove();
    }

    const rawCSS =
      viewSettings?.userUIStylesheet || settings?.globalViewSettings?.userUIStylesheet || '';

    const newStyleEl = document.createElement('style');
    newStyleEl.textContent = rawCSS.replace('foliate-view', `#foliate-view-${bookKey}`);
    document.head.appendChild(newStyleEl);
    setStyleElement(newStyleEl);

    return () => {
      newStyleEl.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewSettings?.userUIStylesheet, settings?.globalViewSettings?.userUIStylesheet, bookKey]);
};
