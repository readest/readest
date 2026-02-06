import { FoliateView } from '@/types/view';
import { throttle } from './throttle';
import { debounce } from './debounce';

export const handleA11yNavigation = (
  view: FoliateView | null,
  document: Document,
  index: number,
) => {
  if (!view) return;

  const state = {
    skipInitial: true,
    hasRecentRelocate: false,
    relocateTimer: null as ReturnType<typeof setTimeout> | null,
  };

  const markRelocateEnd = debounce(() => {
    state.hasRecentRelocate = false;
  }, 2000);

  const markRelocated = () => {
    state.hasRecentRelocate = true;
    markRelocateEnd();
  };

  const throttledMarkRelocated = throttle(markRelocated, 1000);
  view.renderer.addEventListener('scroll', throttledMarkRelocated, { passive: true });
  view.renderer.addEventListener('relocate', throttledMarkRelocated);

  const observer = new IntersectionObserver(
    (entries) => {
      if (state.skipInitial) {
        state.skipInitial = false;
        return;
      }
      if (state.hasRecentRelocate) return;
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const range = document.createRange();
          range.selectNodeContents(entry.target);
          const cfi = view.getCFI(index, range);
          setTimeout(() => {
            if (state.hasRecentRelocate) return;
            const resolved = view.resolveNavigation(cfi);
            view.renderer.goTo?.(resolved);
            console.log('Navigating to new location from screen reader');
          }, 500);
          break;
        }
      }
    },
    { threshold: 0 },
  );

  document.querySelectorAll('a').forEach((el) => {
    el.setAttribute('tabindex', '-1');
  });

  document.querySelectorAll('p').forEach((el) => {
    observer.observe(el);
  });
};
