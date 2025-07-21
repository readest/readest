import clsx from 'clsx';
import React from 'react';
import { Insets } from '@/types/misc';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useReaderStore } from '@/store/readerStore';

interface SectionInfoProps {
  bookKey: string;
  section?: string;
  showDoubleBorder: boolean;
  isScrolled: boolean;
  isVertical: boolean;
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
  horizontalGap,
  contentInsets,
  gridInsets,
}) => {
  const { appService } = useEnv();
  const { hoveredBookKey } = useReaderStore();
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
          'sectioninfo absolute flex items-center overflow-hidden',
          isVertical ? 'writing-vertical-rl max-h-[85%]' : 'top-0 h-[44px]',
          isScrolled && !isVertical && 'bg-base-100',
        )}
        style={
          isVertical
            ? {
                top: `${contentInsets.top * 1.5}px`,
                right: showDoubleBorder
                  ? `calc(${contentInsets.right}px)`
                  : `calc(${Math.max(0, contentInsets.right - 32)}px)`,
                width: showDoubleBorder ? '32px' : `${horizontalGap}%`,
                height: `calc(100% - ${contentInsets.top + contentInsets.bottom}px)`,
              }
            : {
                top: `${topInset}px`,
                insetInlineStart: `calc(${horizontalGap / 2}% + ${contentInsets.left}px)`,
                width: `calc(100% - ${contentInsets.left + contentInsets.right}px)`,
              }
        }
      >
        <h2
          className={clsx(
            'text-neutral-content text-center font-sans text-xs font-light',
            isVertical ? '' : 'line-clamp-1',
            !isVertical && hoveredBookKey == bookKey && 'hidden',
          )}
        >
          {section || ''}
        </h2>
      </div>
    </>
  );
};

export default SectionInfo;
