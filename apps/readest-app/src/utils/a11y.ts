import { FoliateView } from '@/types/view';

export const handleAccessibilityEvents = (
  view: FoliateView | null,
  document: Document,
  index: number,
) => {
  if (!view) return;
  document.querySelectorAll('a, p').forEach((el) => {
    el.setAttribute('tabindex', '-1');
    el.addEventListener('focus', (e) => {
      const range = document.createRange();
      range.selectNodeContents(e.target as Node);
      const cfi = view.getCFI(index, range);
      setTimeout(() => {
        view.goTo(cfi);
      }, 100);
    });
  });
};
