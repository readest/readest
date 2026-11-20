import { useEffect, useRef } from 'react';

// A surface that is already open owns Escape: let it close itself before the
// page underneath steps back. The same set of states is used elsewhere to keep
// page-turn keys from firing through dialogs and popups.
const BLOCKING_OVERLAY_SELECTOR = [
  'dialog[open]',
  '[role="dialog"]:not([aria-hidden="true"])',
  '[role="alertdialog"]:not([aria-hidden="true"])',
  '[role="alert"]:not([aria-hidden="true"])',
  '[role="menu"]:not([aria-hidden="true"])',
  '[aria-haspopup][aria-expanded="true"]',
  '[data-capture-blocking-overlay="true"]',
  '[data-shortcut-recording="true"]',
].join(',');

const isOwnedByOverlay = (target: EventTarget | null) => {
  const element = target instanceof HTMLElement ? target : document.activeElement;
  // A native select and an inline editor both use Escape to cancel themselves.
  if (
    element instanceof HTMLElement &&
    element.closest('select, [contenteditable]:not([contenteditable="false"])')
  ) {
    return true;
  }
  return document.querySelector(BLOCKING_OVERLAY_SELECTOR) !== null;
};

/** Escape leaves an account/login page the same way its Back button does. */
export function useEscapeToGoBack(onGoBack: () => void) {
  const onGoBackRef = useRef(onGoBack);
  onGoBackRef.current = onGoBack;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      if (isOwnedByOverlay(event.target)) return;
      event.preventDefault();
      onGoBackRef.current();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
