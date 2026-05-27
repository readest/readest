import { BookProgress, PageInfo } from '@/types/book';
import { TranslationFunc } from '@/hooks/useTranslation';

/** Reading progress as a 0–1 fraction; 0 when page info is unavailable. */
export const getProgressPercentage = (pageInfo?: PageInfo): number =>
  pageInfo && pageInfo.total > 0 ? (pageInfo.current + 1) / pageInfo.total : 0;

/**
 * Human-readable summary of the local reading position shown in the KOReader
 * sync-conflict dialog.
 *
 * Reflowable books prefer the current section label, but some TOCs leave spine
 * items unlabeled, so `sectionLabel` can be empty or `undefined` at runtime
 * despite its non-optional type. When it is missing we fall back to the page
 * count instead of rendering a bare "undefined".
 */
export const getLocalProgressPreview = (
  local: BookProgress,
  isFixedLayout: boolean,
  _: TranslationFunc,
): string => {
  const pageInfo = isFixedLayout ? local.section : local.pageinfo;
  const percentage = Math.round(getProgressPercentage(pageInfo) * 100);
  const sectionLabel = local.sectionLabel?.trim();

  if (!isFixedLayout && sectionLabel) {
    return `${sectionLabel} (${percentage}%)`;
  }
  if (pageInfo) {
    return _('Page {{page}} of {{total}} ({{percentage}}%)', {
      page: pageInfo.current + 1,
      total: pageInfo.total,
      percentage,
    });
  }
  return _('Current position');
};
