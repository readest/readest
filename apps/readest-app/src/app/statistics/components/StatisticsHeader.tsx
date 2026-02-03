import clsx from 'clsx';
import { useRef } from 'react';
import { IoArrowBack } from 'react-icons/io5';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useTrafficLightStore } from '@/store/trafficLightStore';
import WindowButtons from '@/components/WindowButtons';

interface StatisticsHeaderProps {
  onGoBack: () => void;
}

const StatisticsHeader: React.FC<StatisticsHeaderProps> = ({ onGoBack }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { isTrafficLightVisible } = useTrafficLightStore();
  const headerRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={headerRef}
      className={clsx(
        'bg-base-100/80 fixed z-30 flex w-full items-center justify-between py-2 pe-6 ps-4 backdrop-blur-sm',
        appService?.hasTrafficLight && 'pt-11',
      )}
    >
      <div className='flex items-center gap-4'>
        <button
          aria-label={_('Go Back')}
          onClick={onGoBack}
          className={clsx('btn btn-ghost h-12 min-h-12 w-12 p-0 sm:h-8 sm:min-h-8 sm:w-8')}
        >
          <IoArrowBack className='text-base-content' />
        </button>
        <h1 className='text-base-content text-lg font-semibold'>{_('Reading Statistics')}</h1>
      </div>

      {appService?.hasWindowBar && (
        <WindowButtons
          headerRef={headerRef}
          showMinimize={!isTrafficLightVisible}
          showMaximize={!isTrafficLightVisible}
          showClose={!isTrafficLightVisible}
          onClose={onGoBack}
        />
      )}
    </div>
  );
};

export default StatisticsHeader;
