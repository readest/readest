import clsx from 'clsx';
import { useRef } from 'react';
import { IoArrowBack } from 'react-icons/io5';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useTrafficLight } from '@/hooks/useTrafficLight';
import WindowButtons from '@/components/WindowButtons';

interface PlayerHeaderProps {
  title: string;
  subtitle: string;
  onGoBack: () => void;
}

const PlayerHeader = ({ title, subtitle, onGoBack }: PlayerHeaderProps) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const headerRef = useRef<HTMLDivElement>(null);
  const { isTrafficLightVisible } = useTrafficLight(headerRef);
  const iconSize24 = useResponsiveSize(24);

  return (
    // WindowButtons binds the window-drag listeners to this element, which is
    // why the ref is here: without it a desktop build has no OS title bar on
    // this route and the window cannot be moved from the player at all.
    <div
      ref={headerRef}
      className={clsx(
        'relative flex h-12 w-full items-center pe-2',
        isTrafficLightVisible ? 'ps-20' : 'ps-2',
      )}
    >
      <button
        type='button'
        aria-label={_('Go Back')}
        onClick={onGoBack}
        className='btn btn-ghost btn-circle z-10 flex h-9 min-h-9 w-9'
      >
        <IoArrowBack size={iconSize24 * 0.85} className='rtl:rotate-180' />
      </button>
      <div className='pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-16 text-center'>
        <span className='line-clamp-1 text-sm font-semibold'>{title}</span>
        <span className='text-base-content/70 line-clamp-1 text-xs'>{subtitle}</span>
      </div>
      {appService?.hasWindowBar && (
        <WindowButtons
          className='z-10 ms-auto'
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

export default PlayerHeader;
