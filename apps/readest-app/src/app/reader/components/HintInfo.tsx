import clsx from 'clsx';
import React, { useEffect, useRef } from 'react';
import { useSidebarStore } from '@/store/sidebarStore';
import { useTrafficLightStore } from '@/store/trafficLightStore';
import { eventDispatcher } from '@/utils/event';

interface SectionInfoProps {
  bookKey: string;
  isVertical: boolean;
  horizontalGap: number;
  verticalMargin: number;
}

const HintInfo: React.FC<SectionInfoProps> = ({
  bookKey,
  isVertical,
  horizontalGap,
  verticalMargin,
}) => {
  const { isSideBarVisible } = useSidebarStore();
  const { isTrafficLightVisible } = useTrafficLightStore();
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

  return (
    <div
      className={clsx(
        'sectioninfo absolute flex justify-end overflow-hidden',
        !isVertical && (isTrafficLightVisible && !isSideBarVisible ? 'h-[44px]' : 'h-[30px]'),
        isVertical ? 'writing-vertical-rl w-[32px] items-center' : 'top-0 items-end',
        isVertical ? 'max-h-[50%]' : 'max-w-[50%]',
      )}
      style={
        isVertical
          ? {
              bottom: `calc(${horizontalGap / 2}% + ${verticalMargin}px)`,
              left: `calc(100% - ${horizontalGap * 2}%)`,
              height: `calc(100% - ${verticalMargin * 2}px)`,
            }
          : { right: `${horizontalGap}%` }
      }
    >
      <h2 className={clsx('text-neutral-content text-center font-sans text-xs font-light')}>
        {hintMessage || ''}
      </h2>
    </div>
  );
};

export default HintInfo;
