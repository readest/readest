import clsx from 'clsx';
import React, { useEffect, useRef } from 'react';
import { Insets } from '@/types/misc';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { eventDispatcher } from '@/utils/event';

interface SectionInfoProps {
  bookKey: string;
  showDoubleBorder: boolean;
  isScrolled: boolean;
  isVertical: boolean;
  isEink: boolean;
  horizontalGap: number;
  contentInsets: Insets;
  gridInsets: Insets;
}

const HintInfo: React.FC<SectionInfoProps> = ({
  bookKey,
  showDoubleBorder,
  isScrolled,
  isVertical,
  isEink,
  horizontalGap,
  contentInsets,
  gridInsets,
}) => {
  const { appService } = useEnv();
  const { systemUIVisible, statusBarHeight } = useThemeStore();
  const topInset = Math.max(
    gridInsets.top,
    appService?.isAndroidApp && systemUIVisible ? statusBarHeight / 2 : 0,
  );

  const [hintMessage, setHintMessage] = React.useState<string | null>(null);
  const hintTimeout = useRef(2000);
  const dismissTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleShowHint = (event: CustomEvent) => {
    const { message, bookKey: hintBookKey, timeout = 2000 } = event.detail;
    if (hintBookKey !== bookKey) return;
    setHintMessage(message);
    hintTimeout.current = timeout;
  };

  useEffect(() => {
    eventDispatcher.on('hint', handleShowHint);
    return () => {
      eventDispatcher.off('hint', handleShowHint);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (dismissTimeout.current) clearTimeout(dismissTimeout.current);
    dismissTimeout.current = setTimeout(() => setHintMessage(''), hintTimeout.current);
    return () => {
      if (dismissTimeout.current) clearTimeout(dismissTimeout.current);
    };
  }, [hintMessage]);

  if (!hintMessage) return null;

  return (
    <>
      <div
        className={clsx('absolute left-0 right-0 top-0 z-10', hintMessage ? '' : 'bg-transparent')}
        style={{
          height: `${topInset}px`,
        }}
      />
      <div
        className={clsx(
          'hintinfo absolute flex items-center justify-end overflow-hidden ps-2',
          hintMessage ? '' : 'bg-transparent',
          isVertical ? 'writing-vertical-rl' : 'top-0 h-[44px]',
          isScrolled
            ? isVertical
              ? 'h-full'
              : 'w-full'
            : isVertical
              ? 'max-h-[50%]'
              : 'max-w-[50%]',
        )}
        style={
          isVertical
            ? {
                bottom: `${(contentInsets.bottom - gridInsets.bottom) * 1.5}px`,
                right: showDoubleBorder
                  ? `calc(${contentInsets.right}px)`
                  : `calc(${Math.max(0, contentInsets.right - 32)}px)`,
                width: showDoubleBorder ? '30px' : `${contentInsets.right}px`,
              }
            : {
                top: `${topInset}px`,
                insetInlineEnd: `calc(${horizontalGap / 2}% + ${contentInsets.right / 2}px)`,
              }
        }
      >
        <h2
          className={clsx(
            'text-center font-sans',
            isEink ? 'text-sm font-normal' : 'text-neutral-content text-xs font-light',
          )}
        >
          {hintMessage || ''}
        </h2>
      </div>
    </>
  );
};

export default HintInfo;
