import { FoliateView } from '@/types/view';

export const handleA11yNavigation = (
  view: FoliateView | null,
  document: Document,
  options?: {
    skipToLastPosCallback: () => void;
    skipToLastPosLabel: string;
    skipToNextSectionCallback: () => void;
    skipToNextSectionLabel: string;
  },
) => {
  if (!view) return;

  document.querySelectorAll('a').forEach((el) => {
    el.setAttribute('tabindex', '-1');
  });

  // Inject a hidden "skip to reading position" link as the very first accessible
  // element in the iframe body. NVDA's D-key landmark navigation fires no DOM
  // events, so we cannot detect it; instead, when NVDA enters the landmark its
  // virtual cursor lands on this link first. The user presses Enter to jump to
  // their actual reading position.
  const skipLinkId = 'readest-skip-link-last-pos';
  if (document.body && !document.getElementById(skipLinkId)) {
    const skipLink = document.createElement('div');
    skipLink.id = skipLinkId;
    skipLink.setAttribute('cfi-inert', '');
    skipLink.setAttribute('tabindex', '0');
    skipLink.setAttribute('aria-hidden', 'false');
    skipLink.setAttribute('aria-label', options?.skipToLastPosLabel ?? '');
    Object.assign(skipLink.style, {
      position: 'absolute',
      left: '0px',
      top: 'auto',
      width: '1px',
      height: '1px',
      overflow: 'hidden',
    });
    skipLink.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      options?.skipToLastPosCallback();
    });
    document.body.prepend(skipLink);
  }
  const skipNextSectionLinkId = 'readest-skip-link-next-section';
  if (document.body && !document.getElementById(skipNextSectionLinkId)) {
    const skipLink = document.createElement('div');
    skipLink.id = skipNextSectionLinkId;
    skipLink.setAttribute('cfi-inert', '');
    skipLink.setAttribute('tabindex', '0');
    skipLink.setAttribute('aria-hidden', 'false');
    skipLink.setAttribute('aria-label', options?.skipToNextSectionLabel ?? '');
    Object.assign(skipLink.style, {
      position: 'relative',
      left: '0px',
      top: 'auto',
      width: '1px',
      height: '1px',
      overflow: 'hidden',
    });
    skipLink.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      options?.skipToNextSectionCallback();
    });
    document.body.appendChild(skipLink);
  }
};
