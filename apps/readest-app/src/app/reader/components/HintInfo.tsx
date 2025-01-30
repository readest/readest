import clsx from 'clsx';
import React, { useEffect, useRef } from 'react';
import { useSidebarStore } from '@/store/sidebarStore';
import { eventDispatcher } from '@/utils/event';
import useTrafficLight from '@/hooks/useTrafficLight';

interface SectionInfoProps {
  bookKey: string;
  gapRight: string;
}

const HintInfo: React.FC<SectionInfoProps> = ({ bookKey, gapRight }) => {
  const { isSideBarVisible } = useSidebarStore();
  const { isTrafficLightVisible } = useTrafficLight();
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
        'pageinfo absolute right-0 top-0 flex max-w-[50%] items-end',
        isTrafficLightVisible && !isSideBarVisible ? 'h-[44px]' : 'h-[30px]',
        hintMessage ? '' : '',
      )}
      style={{ right: gapRight }}
    >
      <h2 className='text-neutral-content line-clamp-1 text-center font-sans text-xs font-light'>
        {hintMessage || ''}
      </h2>
    </div>
  );
};

export default HintInfo;
