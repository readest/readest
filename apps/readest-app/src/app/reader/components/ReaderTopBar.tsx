import clsx from 'clsx';
import React, { useRef } from 'react';
import { PiDotsThreeVerticalBold } from 'react-icons/pi';

import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useThemeStore } from '@/store/themeStore';
import { useTrafficLight } from '@/hooks/useTrafficLight';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useTranslation } from '@/hooks/useTranslation';
import Dropdown from '@/components/Dropdown';
import WindowButtons from '@/components/WindowButtons';
import NotebookToggler from './NotebookToggler';
import SettingsToggler from './SettingsToggler';
import ViewMenu from './ViewMenu';

interface ReaderTopBarProps {
  bookKey: string;
  bookKeys: string[];
  onCloseBook: (bookKey: string) => void;
  onDropdownOpenChange?: (isOpen: boolean) => void;
}

const ReaderTopBar: React.FC<ReaderTopBarProps> = ({
  bookKey,
  bookKeys,
  onCloseBook,
  onDropdownOpenChange,
}) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { safeAreaInsets: screenInsets } = useThemeStore();
  const { isTrafficLightVisible } = useTrafficLight();
  const { setHoveredBookKey } = useReaderStore();
  const iconSize16 = useResponsiveSize(16);
  const topBarRef = useRef<HTMLDivElement>(null);

  const windowButtonVisible = appService?.hasWindowBar && !isTrafficLightVisible;
  const hasMinMax = bookKeys.length === 1 && !!windowButtonVisible;
  const topInset = appService?.hasSafeAreaInset ? (screenInsets?.top ?? 0) : 5;

  return (
    <div
      ref={topBarRef}
      className={clsx(
        'reader-top-bar absolute right-0 top-0 z-30',
        'hidden items-center gap-1.5 sm:flex',
        hasMinMax ? 'pr-2' : 'pr-5',
      )}
      style={{ paddingTop: `${topInset}px` }}
    >
      <SettingsToggler bookKey={bookKey} />
      <NotebookToggler bookKey={bookKey} />
      <Dropdown
        label={_('View Options')}
        className='exclude-title-bar-mousedown dropdown-bottom dropdown-end'
        buttonClassName='btn btn-ghost h-8 min-h-8 w-8 p-0'
        toggleButton={<PiDotsThreeVerticalBold size={iconSize16} />}
        onToggle={onDropdownOpenChange}
      >
        <ViewMenu bookKey={bookKey} />
      </Dropdown>
      <WindowButtons
        className='gap-1 pr-0 text-[#b9852c] [&_button:hover]:!bg-transparent [&_button:hover]:!text-[#c99535] [&_button]:!rounded-none [&_button]:!border-0 [&_button]:!bg-transparent [&_button]:!text-[#b9852c] [&_button]:!shadow-none'
        headerRef={topBarRef}
        showMinimize={hasMinMax}
        showMaximize={hasMinMax}
        closeButtonLabel={_('Close Book')}
        onClose={() => {
          setHoveredBookKey(null);
          onCloseBook(bookKey);
        }}
      />
      <style jsx global>{`
        .reader-top-bar .btn {
          box-shadow: none;
          color: #8c816d;
          background: transparent;
          border: 1px solid transparent;
          border-radius: 5px;
          transition:
            background-color 140ms ease,
            border-color 140ms ease,
            color 140ms ease;
        }

        .reader-top-bar .btn:hover {
          color: #c99535;
          border-color: rgba(255, 255, 255, 0.06);
          background: rgba(20, 16, 12, 0.18);
        }

        .reader-top-bar .btn:focus-visible,
        .reader-top-bar button:focus-visible {
          outline: none;
          box-shadow:
            0 0 0 1px rgba(201, 164, 90, 0.9),
            0 0 0 3px rgba(120, 24, 18, 0.45);
        }
      `}</style>
    </div>
  );
};

export default ReaderTopBar;
