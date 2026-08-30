import clsx from 'clsx';
import React from 'react';
import { Insets } from '@/types/misc';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { getHeaderBandGeometry } from '@/utils/insets';
import { getBookDataAttributes } from '@/utils/book';
import {
  getChromeChip,
  getChromeFontSize,
  getChromeTextColor,
  isChromeStyled,
} from '../utils/headerFooterStyle';
import { useBookDataStore } from '@/store/bookDataStore';

interface SectionInfoProps {
  bookKey: string;
  section?: string;
  showDoubleBorder: boolean;
  isScrolled: boolean;
  isVertical: boolean;
  isEink: boolean;
  horizontalGap: number;
  contentInsets: Insets;
  gridInsets: Insets;
}

const SectionInfo: React.FC<SectionInfoProps> = ({
  bookKey,
  section,
  showDoubleBorder,
  isScrolled,
  isVertical,
  isEink,
  horizontalGap,
  contentInsets,
  gridInsets,
}) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { hoveredBookKey, getView, getViewSettings, setHoveredBookKey } = useReaderStore();
  const { systemUIVisible, statusBarHeight } = useThemeStore();
  const getBookData = useBookDataStore((s) => s.getBookData);
  const viewSettings = getViewSettings(bookKey)!;
  const bookData = getBookData(bookKey);
  const topInset = Math.max(
    gridInsets.top,
    appService?.isAndroidApp && systemUIVisible ? statusBarHeight / 2 : 0,
  );
  // Negative top margins lift the band (and the scrolled-mode notch mask)
  // into the notch instead of collapsing it (#5303).
  const band = getHeaderBandGeometry(topInset, viewSettings.marginTopPx);
  const maskHeight = Math.min(topInset, band.bottom);

  // The header band is reserved margin except for a fixed-layout book in
  // scrolled mode, where FoliateViewer pins scrollTop to 0 and the pages run
  // underneath it. `auto` never gives the header a chip either way; a color
  // the reader chose (#5938) paints one in both flow modes.
  const chip = getChromeChip(viewSettings, 'header', {
    isEink,
    isScrolled,
    isVertical,
    bandReserved: !isScrolled || !bookData?.isFixedLayout,
  });
  const textColor = getChromeTextColor(viewSettings, isEink);
  const fontSize = getChromeFontSize(viewSettings, isEink);
  // Once the reader styles the chrome themselves the blend has to stand down:
  // it inverts their text color, and differencing a child that carries its own
  // background paints it solid black (#5342).
  const blended = !!bookData?.isFixedLayout && !isEink && !isChromeStyled(viewSettings);

  const handleNotchClick = () => {
    if (eventDispatcher.dispatchSync('iframe-single-click')) return;
    if (isScrolled) {
      getView(bookKey)?.renderer.scrollToAnchor?.(0, 'anchor', true);
    }
  };

  const handleSectionClick = () => {
    if (eventDispatcher.dispatchSync('iframe-single-click')) return;
    setHoveredBookKey(bookKey);
  };

  return (
    <>
      <div
        className={clsx(
          // Spans the grid cell and clips down to the top inset strip so the
          // texture ::before (.notch-masked, see styles/textures.ts) shares
          // .foliate-viewer::before's paint box — background-size cover/contain
          // resolves against the element box, so a strip-sized box would
          // mis-tile at the seam (#4486). clip-path also clips hit-testing,
          // keeping the click target the inset strip only.
          'notch-area absolute inset-0 z-10',
          // Fixed-layout pages fill the screen edge to edge and their chrome
          // overlays the page (mix-blend-difference title, #4901); the opaque
          // mask would clip the document at the camera hole / status bar.
          isScrolled && !isVertical && !bookData?.isFixedLayout && 'notch-masked bg-base-100',
        )}
        role='none'
        tabIndex={-1}
        onClick={handleNotchClick}
        style={{
          clipPath: `inset(0 0 calc(100% - ${maskHeight}px) 0)`,
        }}
      />
      <div
        className={clsx(
          'sectioninfo absolute flex items-center overflow-hidden font-sans',
          // A lifted band overlaps the notch mask (z-10) and must win as the
          // later sibling — z-auto would lose to any positive z. Only when
          // lifted: an unconditional z-10 also covers the desktop HeaderBar
          // (z-auto wrapper, so even its z-20 button groups stay below) and
          // makes the toolbar unclickable.
          !isVertical && band.top < topInset && 'z-10',
          isEink
            ? 'font-normal'
            : blended
              ? 'text-white/75 mix-blend-difference font-light'
              : 'text-base-content font-light',
          isVertical ? 'writing-vertical-rl max-h-[85%]' : 'top-0',
        )}
        role='none'
        tabIndex={-1}
        onClick={handleSectionClick}
        {...getBookDataAttributes(bookData?.book?.title, bookData?.book?.metadata)}
        style={{
          fontSize: `${fontSize}px`,
          ...(textColor ? { color: textColor } : {}),
          ...(isVertical
            ? {
                top: `${(contentInsets.top - gridInsets.top) * 1.5}px`,
                bottom: `${(contentInsets.bottom - gridInsets.bottom) * 1.5}px`,
                right: showDoubleBorder
                  ? `calc(${contentInsets.right}px)`
                  : `calc(${Math.max(0, contentInsets.right - 32)}px)`,
                width: showDoubleBorder ? '32px' : `${contentInsets.right}px`,
              }
            : {
                top: `${band.top}px`,
                paddingInline: `calc(${horizontalGap / 2}% + ${contentInsets.left / 2}px)`,
                width: '100%',
                height: `${band.height}px`,
              }),
        }}
      >
        <span
          aria-label={section ? _('Section Title') + `: ${section}` : ''}
          className={clsx(
            'text-center',
            isVertical ? '' : 'line-clamp-1',
            // Shrink-wraps around the title (the span is a flex item), so the
            // header never becomes the full-width opaque bar of #4157.
            chip && section && 'section-pill eink-bordered rounded-md px-1.5',
            chip?.kind === 'theme' && section && 'bg-base-100/85',
            !isVertical &&
              (hoveredBookKey == bookKey || (hoveredBookKey && appService?.isMobile)) &&
              'hidden',
          )}
          style={chip?.kind === 'custom' && section ? { backgroundColor: chip.color } : undefined}
        >
          {section || ''}
        </span>
      </div>
    </>
  );
};

export default SectionInfo;
