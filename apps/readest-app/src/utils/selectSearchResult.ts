import type { FoliateView } from '@/types/view';

export const goToAndSelectSearchResult = async (view: FoliateView, cfi: string) => {
  await view.goTo(cfi);
  const { index, anchor } = view.resolveCFI(cfi);
  const content = view.renderer.getContents().find((item) => item.index === index);
  if (!content?.doc) return false;
  const resolved = anchor(content.doc);
  if (!resolved || typeof resolved === 'number' || !('startContainer' in resolved)) {
    return false;
  }
  const selection = content.doc.defaultView?.getSelection();
  if (!selection) return false;
  selection.removeAllRanges();
  selection.addRange(resolved);
  return true;
};
