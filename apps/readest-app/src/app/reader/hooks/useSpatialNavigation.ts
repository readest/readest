import { useEffect } from 'react';

function getButtons(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button:not([disabled])'));
}

function getFocusableButtons(container: HTMLElement): HTMLButtonElement[] {
  // Try each button to see if it can actually receive focus.
  // This correctly handles all hiding methods (display:none, visibility:hidden,
  // fixed positioning where offsetParent is null, etc.)
  const prev = document.activeElement as HTMLElement | null;
  const focusable: HTMLButtonElement[] = [];
  for (const btn of getButtons(container)) {
    btn.focus();
    if (document.activeElement === btn) {
      focusable.push(btn);
    }
  }
  prev?.focus();
  return focusable;
}

function focusFirstButton(container: HTMLElement) {
  for (const btn of getButtons(container)) {
    btn.focus();
    if (document.activeElement === btn) return;
  }
}

/**
 * Arrow key navigation for toolbar containers (header bar, footer bar).
 * Left/Right navigate between buttons within the toolbar.
 * Up/Down move focus between the header bar and footer bar.
 * Auto-focuses the first button when the toolbar becomes visible.
 */
export function useSpatialNavigation(
  containerRef: React.RefObject<HTMLElement | null>,
  isVisible: boolean,
) {
  // Auto-focus first button when toolbar becomes visible
  useEffect(() => {
    if (!isVisible) return;
    const container = containerRef.current;
    if (!container) return;
    const timer = setTimeout(() => focusFirstButton(container), 100);
    return () => clearTimeout(timer);
  }, [isVisible, containerRef]);

  useEffect(() => {
    if (!isVisible) return;
    const container = containerRef.current;
    if (!container) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const buttons = getFocusableButtons(container);
        if (buttons.length === 0) return;

        const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (currentIndex === -1) return;

        const targetIndex = e.key === 'ArrowRight' ? currentIndex + 1 : currentIndex - 1;

        if (targetIndex >= 0 && targetIndex < buttons.length) {
          buttons[targetIndex]?.focus();
        }

        e.stopPropagation();
        e.preventDefault();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const target =
          e.key === 'ArrowDown'
            ? document.querySelector<HTMLElement>('.footer-bar')
            : document.querySelector<HTMLElement>('.header-bar');

        if (target) {
          focusFirstButton(target);
          e.stopPropagation();
          e.preventDefault();
        }
      }
    };

    container.addEventListener('keydown', handleKeyDown);
    return () => container.removeEventListener('keydown', handleKeyDown);
  }, [isVisible, containerRef]);
}
