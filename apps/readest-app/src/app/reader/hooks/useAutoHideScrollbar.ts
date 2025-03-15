import { getOSPlatform } from '@/utils/misc';

// NOTE: Be careful to use this hook. When the scrollbar is set always visible in macOS,
// hide it will change the layout. Make sure to only use it in constrained widgets.
// See https://github.com/readest/readest/issues/600
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
