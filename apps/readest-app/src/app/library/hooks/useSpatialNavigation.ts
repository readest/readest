import { useEffect, useCallback } from 'react';

const ARROW_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

function getGridColumnCount(items: HTMLElement[]): number {
  if (items.length < 2) return 1;
  const firstTop = items[0]!.getBoundingClientRect().top;
  for (let i = 1; i < items.length; i++) {
    if (items[i]!.getBoundingClientRect().top > firstTop + 5) return i;
  }
  return items.length;
}

function getGridItems(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[role="button"][tabindex="0"]'));
}

export function useSpatialNavigation(containerRef: React.RefObject<HTMLElement | null>) {
  // Grid navigation within the bookshelf
  const handleGridKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!ARROW_KEYS.has(e.key)) return;

      const container = containerRef.current;
      if (!container) return;

      const items = getGridItems(container);
      if (items.length === 0) return;

      const currentIndex = items.indexOf(document.activeElement as HTMLElement);
      if (currentIndex === -1) {
        items[0]?.focus();
        e.preventDefault();
        return;
      }

      const cols = getGridColumnCount(items);
      let targetIndex = currentIndex;

      switch (e.key) {
        case 'ArrowRight':
          targetIndex = currentIndex + 1;
          break;
        case 'ArrowLeft':
          targetIndex = currentIndex - 1;
          break;
        case 'ArrowDown':
          targetIndex = currentIndex + cols;
          break;
        case 'ArrowUp':
          targetIndex = currentIndex - cols;
          break;
      }

      if (targetIndex >= 0 && targetIndex < items.length && targetIndex !== currentIndex) {
        items[targetIndex]?.focus();
        items[targetIndex]?.scrollIntoView({ block: 'nearest' });
        e.preventDefault();
      }
    },
    [containerRef],
  );

  // Handle focus transition from outside the bookshelf (e.g. header) into the grid
  const handleWindowKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key !== 'ArrowDown') return;

      const container = containerRef.current;
      if (!container) return;

      // Only handle when focus is outside the bookshelf
      if (container.contains(document.activeElement)) return;

      const items = getGridItems(container);
      if (items.length === 0) return;

      items[0]?.focus();
      items[0]?.scrollIntoView({ block: 'nearest' });
      e.preventDefault();
    },
    [containerRef],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.addEventListener('keydown', handleGridKeyDown);
    window.addEventListener('keydown', handleWindowKeyDown);
    return () => {
      container.removeEventListener('keydown', handleGridKeyDown);
      window.removeEventListener('keydown', handleWindowKeyDown);
    };
  }, [handleGridKeyDown, handleWindowKeyDown, containerRef]);
}
