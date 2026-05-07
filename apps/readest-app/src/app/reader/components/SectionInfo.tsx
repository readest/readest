import clsx from 'clsx';
import React from 'react';
import { Insets } from '@/types/misc';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';

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
  const { hoveredBookKey, getView, setHoveredBookKey } = useReaderStore();
  const { systemUIVisible, statusBarHeight } = useThemeStore();
  const topInset = Math.max(
    gridInsets.top,
    appService?.isAndroidApp && systemUIVisible ? statusBarHeight / 2 : 0,
  );

  const handleNotchClick = () => {
    if (isScrolled) {
      getView(bookKey)?.renderer.scrollToAnchor?.(0, 'anchor', true);
    }
  };

  return (
    <>
      <div
        className={clsx(
          'notch-area absolute left-0 right-0 top-0 z-10',
          isScrolled && !isVertical && 'citadel-section-bg',
        )}
        role='none'
        tabIndex={-1}
        onClick={handleNotchClick}
        style={{
          height: `${topInset}px`,
        }}
      />
      <div
        className={clsx(
          'sectioninfo absolute flex items-center overflow-hidden',
          isEink
            ? 'text-base-content text-sm font-normal'
            : 'citadel-section-info text-xs font-normal',
          isVertical ? 'writing-vertical-rl max-h-[85%]' : 'top-0 h-[44px]',
          isScrolled && !isVertical && (isEink ? 'bg-base-100' : 'citadel-section-bg'),
        )}
        role='none'
        tabIndex={-1}
        onClick={() => setHoveredBookKey(bookKey)}
        style={
          isVertical
            ? {
                top: `${(contentInsets.top - gridInsets.top) * 1.5}px`,
                bottom: `${(contentInsets.bottom - gridInsets.bottom) * 1.5}px`,
                right: showDoubleBorder
                  ? `calc(${contentInsets.right}px)`
                  : `calc(${Math.max(0, contentInsets.right - 32)}px)`,
                width: showDoubleBorder ? '32px' : `${contentInsets.right}px`,
              }
            : {
                top: `${topInset}px`,
                paddingInline: `calc(${horizontalGap / 2}% + ${contentInsets.left / 2}px)`,
                width: '100%',
              }
        }
      >
        <span
          aria-label={section ? _('Section Title') + `: ${section}` : ''}
          className={clsx(
            !isEink && 'citadel-section-text',
            'text-center',
            isVertical ? '' : 'line-clamp-1',
            !isVertical &&
              (hoveredBookKey == bookKey || (hoveredBookKey && appService?.isMobile)) &&
              'hidden',
          )}
        >
          {section || ''}
        </span>
      </div>
      <style jsx global>{`
        .sectioninfo.citadel-section-info {
          color: rgba(196, 158, 90, 0.78);
        }
        .sectioninfo .citadel-section-text {
          font-family: 'Iowan Old Style', 'Palatino Linotype', Georgia, serif;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          font-size: 0.7rem;
          color: rgba(196, 158, 90, 0.78);
          text-shadow: 0 1px 0 rgba(0, 0, 0, 0.55);
        }
        .notch-area.citadel-section-bg,
        .sectioninfo.citadel-section-bg {
          background: linear-gradient(180deg, rgba(14, 10, 9, 0.96), rgba(11, 8, 7, 0.92));
        }
      `}</style>
    </>
  );
};

export default SectionInfo;
