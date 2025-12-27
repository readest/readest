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
  const { hoveredBookKey, setHoveredBookKey } = useReaderStore();
  const { systemUIVisible, statusBarHeight } = useThemeStore();
  const topInset = Math.max(
    gridInsets.top,
    appService?.isAndroidApp && systemUIVisible ? statusBarHeight / 2 : 0,
  );

  return (
    <>
      <div
        className={clsx(
          'absolute left-0 right-0 top-0 z-10',
          isScrolled && !isVertical && 'bg-base-100',
        )}
        style={{
          height: `${topInset}px`,
        }}
      />
      <div
        className={clsx(
          'sectioninfo absolute flex items-center overflow-hidden font-sans',
          isEink ? 'text-sm font-normal' : 'text-neutral-content text-xs font-light',
          isVertical ? 'writing-vertical-rl max-h-[85%]' : 'top-0 h-[44px]',
          isScrolled && !isVertical && 'bg-base-100',
        )}
        role='none'
        onClick={() => setHoveredBookKey(bookKey)}
        style={
          isVertical
            ? {
                top: `${(contentInsets.top - gridInsets.top) * 1.5}px`,
                right: showDoubleBorder
                  ? `calc(${contentInsets.right}px)`
                  : `calc(${Math.max(0, contentInsets.right - 32)}px)`,
                width: showDoubleBorder ? '32px' : `${contentInsets.right}px`,
                height: `calc(100% - ${contentInsets.top + contentInsets.bottom}px)`,
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
            'text-center',
            isVertical ? '' : 'line-clamp-1',
            !isVertical && hoveredBookKey == bookKey && 'hidden',
          )}
        >
          {section || ''}
        </span>
      </div>
    </>
  );
};

export default SectionInfo;
