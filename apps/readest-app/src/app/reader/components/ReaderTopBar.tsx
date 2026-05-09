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
  onGoToLibrary?: () => void;
  onDropdownOpenChange?: (isOpen: boolean) => void;
}

const ReaderTopBar: React.FC<ReaderTopBarProps> = ({
  bookKey,
  bookKeys,
  onCloseBook,
  onGoToLibrary,
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
  const topBarHeight = topInset + 40;

  return (
    <div
      ref={topBarRef}
      className={clsx(
        'reader-top-bar titlebar pointer-events-none absolute left-0 right-0 top-0 z-30',
        'hidden items-start justify-end sm:flex',
      )}
      style={{ height: `${topBarHeight}px`, paddingTop: `${topInset}px` }}
    >
      <div
        aria-hidden='true'
        className='reader-window-drag-region pointer-events-auto absolute bottom-0 top-0 hidden sm:block'
        style={{
          left: 'clamp(132px, 9vw, 176px)',
          right: hasMinMax ? '360px' : '260px',
        }}
      />
      <div
        className={clsx(
          'exclude-title-bar-mousedown pointer-events-auto flex items-center gap-1.5',
          hasMinMax ? 'pr-2' : 'pr-5',
        )}
      >
        {onGoToLibrary && (
          <button
            type='button'
            title={_('Go to Library')}
            onClick={onGoToLibrary}
            className='citadel-library-btn hidden items-center justify-center px-3.5 sm:flex'
          >
            <span className='citadel-library-btn-label'>{_('LIBRARY')}</span>
          </button>
        )}
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
      </div>
      <style jsx global>{`
        .reader-top-bar.titlebar {
          background: transparent;
          border-bottom: 0;
          box-shadow: none;
          backdrop-filter: none;
          -webkit-backdrop-filter: none;
        }

        .reader-window-drag-region {
          cursor: default;
        }

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

        .reader-top-bar .citadel-library-btn {
          height: 32px;
          min-height: 32px;
          padding: 0 14px;
          border-radius: 8px;
          border: 1px solid rgba(168, 124, 64, 0.62);
          background: linear-gradient(180deg, rgba(26, 17, 13, 0.96), rgba(14, 10, 8, 0.98));
          box-shadow:
            inset 0 1px 0 rgba(255, 237, 193, 0.06),
            inset 0 -1px 0 rgba(0, 0, 0, 0.36),
            0 6px 14px rgba(0, 0, 0, 0.42);
          transition:
            color 140ms ease,
            background 140ms ease,
            border-color 140ms ease,
            transform 140ms ease;
        }

        .reader-top-bar .citadel-library-btn:hover {
          background: linear-gradient(180deg, rgba(46, 26, 20, 0.97), rgba(22, 14, 11, 0.98));
          border-color: rgba(214, 168, 88, 0.85);
          transform: translateY(-1px);
        }

        .reader-top-bar .citadel-library-btn .citadel-library-btn-label {
          font-family: 'Iowan Old Style', 'Palatino Linotype', Georgia, serif;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.22em;
          color: rgba(218, 181, 114, 0.96);
          text-shadow: 0 1px 0 rgba(0, 0, 0, 0.55);
        }

        .reader-top-bar .citadel-library-btn:hover .citadel-library-btn-label {
          color: rgba(243, 215, 140, 0.98);
        }
      `}</style>
    </div>
  );
};

export default ReaderTopBar;
