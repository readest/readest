import clsx from 'clsx';
import { useRef } from 'react';
import { IoArrowBack } from 'react-icons/io5';
import { useEnv } from '@/context/EnvContext';
import { useTrafficLightStore } from '@/store/trafficLightStore';
import WindowButtons from '@/components/WindowButtons';

interface ProfileHeaderProps {
  onGoBack: () => void;
}

const ProfileHeader: React.FC<ProfileHeaderProps> = ({ onGoBack }) => {
  const { appService } = useEnv();
  const { isTrafficLightVisible } = useTrafficLightStore();
  const headerRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={headerRef}
      className={clsx(
        'fixed z-30 flex w-full items-center justify-between py-2 pe-6 ps-4',
        appService?.hasTrafficLight && 'pt-11',
      )}
    >
      <button
        onClick={onGoBack}
        className={clsx('btn btn-ghost h-12 min-h-12 w-12 p-0 sm:h-8 sm:min-h-8 sm:w-8')}
      >
        <IoArrowBack className='text-base-content' />
      </button>

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
export default ProfileHeader;
