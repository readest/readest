// Modal dialogs: open through the `open` attribute, ARIA, or daisyUI's class.
const READER_MODALS = [
  'dialog[open]',
  'dialog.modal-open',
  '[role="dialog"][aria-modal="true"]:not([aria-hidden="true"])',
  '[role="dialog"].modal-open',
  '[role="alertdialog"]:not([aria-hidden="true"])',
];
const READER_MODAL_SELECTOR = READER_MODALS.join(',');

export const hasReaderModal = () =>
  typeof document !== 'undefined' && document.querySelector(READER_MODAL_SELECTOR) !== null;

// Shared HTML/ARIA state covers dialogs and menus that can stay open after
// the reader toolbars hide, without subscribing to each popup's local state.
const READER_OVERLAYS = [
  ...READER_MODALS,
  '[aria-haspopup][aria-expanded="true"]',
  '[role="menu"][data-state="open"]',
  '[role="listbox"][data-state="open"]',
  '[data-capture-blocking-overlay="true"]',
  '.fixed.inset-0 [role="alert"]:not([aria-hidden="true"])',
];
const READER_OVERLAY_SELECTOR = READER_OVERLAYS.join(',');

export const hasReaderOverlay = () =>
  typeof document !== 'undefined' && document.querySelector(READER_OVERLAY_SELECTOR) !== null;

// Paragraph Mode is modal over the page, but it is a way of reading, not
// reader controls: the volume keys step through its paragraphs (#7227). A menu
// or dialog opened over it still counts.
const READER_CONTROLS_SELECTOR = READER_OVERLAYS.map(
  (selector) => `${selector}:not([data-reading-surface])`,
).join(',');

export const hasReaderControlsOverlay = () =>
  typeof document !== 'undefined' && document.querySelector(READER_CONTROLS_SELECTOR) !== null;

const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;

/** Share one document observer across every mounted reader cell. */
export const subscribeReaderOverlays = (listener: () => void) => {
  listeners.add(listener);
  if (
    !observer &&
    typeof MutationObserver !== 'undefined' &&
    typeof document !== 'undefined' &&
    document.body
  ) {
    observer = new MutationObserver(() => {
      for (const notify of listeners) notify();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      // Static role/class semantics are observed through mount/unmount. Watch
      // only state attributes so ordinary React class updates don't rescan.
      attributeFilter: [
        'open',
        'aria-expanded',
        'aria-hidden',
        'data-state',
        'data-capture-blocking-overlay',
        'data-capture-invalidating-overlay',
      ],
    });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      observer?.disconnect();
      observer = null;
    }
  };
};
