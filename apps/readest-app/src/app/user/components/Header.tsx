import clsx from 'clsx';
import { useRef } from 'react';
import { IoArrowBack } from 'react-icons/io5';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useTrafficLightStore } from '@/store/trafficLightStore';
import WindowButtons from '@/components/WindowButtons';

interface ProfileHeaderProps {
  onGoBack: () => void;
}

const ProfileHeader: React.FC<ProfileHeaderProps> = ({ onGoBack }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { isTrafficLightVisible } = useTrafficLightStore();
  const headerRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={headerRef}
      className={clsx(
        'fixed z-30 flex w-full items-center justify-between py-2 pe-6 ps-4',
        appService?.hasTrafficLight && 'pt-11',
        // The strip spans the full width with no background, so its empty
        // middle is an invisible overlay that swallows clicks on whatever
        // scrolls beneath it. Only a desktop window bar needs the strip itself
        // to receive pointer events, because WindowButtons binds the window
        // drag listeners to this element; elsewhere it must let clicks through
        // and only its own controls stay interactive.
        !appService?.hasWindowBar && 'pointer-events-none',
      )}
    >
      <button
        aria-label={_('Go Back')}
        onClick={onGoBack}
        className={clsx(
          'btn btn-ghost pointer-events-auto h-12 min-h-12 w-12 p-0 sm:h-8 sm:min-h-8 sm:w-8',
        )}
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
