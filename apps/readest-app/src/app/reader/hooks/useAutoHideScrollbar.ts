import { getOSPlatform } from '@/utils/misc';

export const useAutoHideScrollbar = () => {
  const shouldAutoHideScrollbar = ['macos', 'ios'].includes(getOSPlatform());
  const handleScrollbarAutoHide = (doc: Document) => {
    if (doc && doc.defaultView && doc.defaultView.frameElement) {
      const iframe = doc.defaultView.frameElement as HTMLIFrameElement;
      const container = iframe.parentElement?.parentElement;
      if (!container) return;

      let hideScrollbarTimeout: ReturnType<typeof setTimeout>;
      const showScrollbar = () => {
        container.style.overflow = 'auto';
        container.style.scrollbarWidth = 'thin';
      };

      const hideScrollbar = () => {
        container.style.overflow = 'hidden';
        container.style.scrollbarWidth = 'none';
        requestAnimationFrame(() => {
          container.style.overflow = 'auto';
        });
      };
      container.addEventListener('scroll', () => {
        showScrollbar();
        clearTimeout(hideScrollbarTimeout);
        hideScrollbarTimeout = setTimeout(hideScrollbar, 1000);
      });
      hideScrollbar();
    }
  };

  return { shouldAutoHideScrollbar, handleScrollbarAutoHide };
};
