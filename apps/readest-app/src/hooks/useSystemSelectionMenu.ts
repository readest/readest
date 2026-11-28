import { useEffect } from 'react';
import { useEnv } from '@/context/EnvContext';
import { setSelectionSuppressed } from '@/utils/bridge';

// iOS (#8045): the native side keeps the system menu (Copy, Look Up, Share)
// off non-editable selections, so it never covers Readest's own selection
// toolbar. Text the app shows beside the book, such as a docked definition or
// an AI answer, is there to be copied, so the menu is let through while that
// text is selected. The app document and the book's frames each keep their
// own selection: selecting in one leaves the other in place and fires no event
// there. So each reports its own new selections, and the latest one decides.

let suppressed: boolean | null = null;

/** iOS only: whether the system menu stays off the next selection. */
export const suppressSystemSelectionMenu = (value: boolean) => {
  if (suppressed === value) return;
  suppressed = value;
  setSelectionSuppressed({ target: 'menu', suppressed: value }).catch(() => {});
};

// Surfaces in the app document that show Readest's own selection toolbar.
const OWN_TOOLBAR_SELECTOR = '.footnote-popup, .paragraph-content';

export const useSystemSelectionMenu = () => {
  const { appService } = useEnv();

  useEffect(() => {
    if (!appService?.isIOSApp) return;
    const handleSelectionChange = () => {
      const sel = document.getSelection();
      const node = sel && !sel.isCollapsed ? sel.anchorNode : null;
      const el = node instanceof Element ? node : node?.parentElement;
      suppressSystemSelectionMenu(!el || !!el.closest(OWN_TOOLBAR_SELECTOR));
    };
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, [appService]);
};
