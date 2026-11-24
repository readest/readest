import type { Location, SectionFragment } from '@/libs/document';
import type { BookProgress, PageInfo, ViewSettings } from '@/types/book';
import type { FoliateView } from '@/types/view';
import {
  CHUNKED_SECTION_THRESHOLD,
  type CalibratedSectionSource,
  getCalibratedPagePair,
  getScreenPageMap,
  locateScreenPage,
} from '@/utils/chapterScreens';

interface ScreenPageSection extends CalibratedSectionSource {
  location?: Location;
  fragments?: SectionFragment[];
}

/**
 * With Stable Page Numbers off, the footer counts this device's screens
 * (chapterScreens.ts). Every other page readout counts the same pages: the
 * footer bar's label, slider and jump field, and the TOC (#7445, #7453).
 * Fixed layout keeps its real pages and scrolled mode has no screens.
 */
export const usesScreenPages = (
  viewSettings: ViewSettings | null | undefined,
  isFixedLayout: boolean | undefined,
  sections: unknown[] | undefined,
) =>
  viewSettings?.stablePageNumbers === false &&
  viewSettings.progressStyle === 'fraction' &&
  !viewSettings.scrolled &&
  !isFixedLayout &&
  !!sections?.length;

/** The screen page pair (0-based current) at the reader's position. */
export const getScreenPageInfo = (
  bookKey: string,
  view: FoliateView | null | undefined,
  sections: CalibratedSectionSource[],
  progress: BookProgress | null | undefined,
): PageInfo => {
  const spine = progress?.section?.current ?? 0;
  const sectionFractions = view?.getSectionFractions() ?? [];
  const sectionStart = sectionFractions[spine] ?? 0;
  const span = (sectionFractions[spine + 1] ?? 0) - sectionStart;
  const chapterFraction =
    span > 0 ? Math.min(1, Math.max(0, ((progress?.fraction ?? 0) - sectionStart) / span)) : 0;
  const pair = getCalibratedPagePair(
    bookKey,
    sections,
    spine,
    view?.renderer?.page ?? 0,
    (sections[spine]?.size ?? 0) > CHUNKED_SECTION_THRESHOLD,
    chapterFraction,
  );
  // At two columns a short last chapter can share the last screen with the
  // one before, and only the first is the screen's primary chapter: the last
  // screen still reads total / total, as the byte-grid pair does.
  const current = view?.renderer?.atEnd ? pair.total - 1 : pair.current;
  return { current, next: current, total: pair.total };
};

/** The book fraction view.goToFraction lands on screen page `page` (0-based) with. */
export const getScreenPageFraction = (
  bookKey: string,
  view: FoliateView,
  sections: CalibratedSectionSource[],
  page: number,
) => {
  const target = locateScreenPage(getScreenPageMap(bookKey, sections), page);
  if (!target) return null;
  const sectionFractions = view.getSectionFractions();
  const start = sectionFractions[target.index] ?? 0;
  return start + target.fraction * ((sectionFractions[target.index + 1] ?? start) - start);
};

/**
 * The 1-based screen page of every section and TOC anchor location, which
 * TOC items share by reference (services/nav/locations.ts). An anchor's place
 * in its section is read from its byte-grid location.
 */
export const getLocationScreenPages = (bookKey: string, sections: ScreenPageSection[]) => {
  const { counts, starts, total } = getScreenPageMap(bookKey, sections);
  const pages = new Map<Location, number>();
  sections.forEach((section, spine) => {
    const location = section.location;
    if (!location) return;
    const count = counts[spine]!;
    const span = location.next - location.current;
    const pageAt = (fraction: number) =>
      (count > 0
        ? starts[spine]! + Math.min(count - 1, Math.floor(fraction * count))
        : Math.max(0, Math.min(starts[spine]!, total - 1))) + 1;
    pages.set(location, pageAt(0));
    const addFragments = (fragments: SectionFragment[] | undefined) =>
      fragments?.forEach((fragment) => {
        if (fragment.location && span > 0) {
          const offset = (fragment.location.current - location.current) / span;
          pages.set(fragment.location, pageAt(Math.min(1, Math.max(0, offset))));
        }
        addFragments(fragment.fragments);
      });
    addFragments(section.fragments);
  });
  return pages;
};
