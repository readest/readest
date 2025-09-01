import clsx from 'clsx';
import React from 'react';
import { MdPlayArrow, MdOutlinePause, MdFastRewind, MdFastForward } from 'react-icons/md';
import { Insets } from '@/types/misc';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';

type TTSBarProps = {
  bookKey: string;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onBackward: () => void;
  onForward: () => void;
  gridInsets: Insets;
};

const TTSBar = ({
  bookKey,
  isPlaying,
  onTogglePlay,
  onBackward,
  onForward,
  gridInsets,
}: TTSBarProps) => {
  const { appService } = useEnv();
  const { hoveredBookKey, setHoveredBookKey } = useReaderStore();
  const iconSize32 = useResponsiveSize(30);
  const iconSize48 = useResponsiveSize(36);

  const isVisible = hoveredBookKey !== bookKey;

  return (
    <div
      className={clsx(
        'bg-base-100 absolute bottom-0 z-40',
        'inset-x-0 mx-auto flex w-full justify-center sm:w-fit',
        'transition-opacity duration-300',
        isVisible ? `pointer-events-auto opacity-100` : `pointer-events-none opacity-0`,
      )}
      style={{ paddingBottom: appService?.hasSafeAreaInset ? `${gridInsets.bottom * 0.33}px` : 0 }}
      onMouseEnter={() => !appService?.isMobile && setHoveredBookKey('')}
      onTouchStart={() => !appService?.isMobile && setHoveredBookKey('')}
    >
      <div className='text-base-content flex h-[52px] items-center space-x-2 px-2'>
        <button
          onClick={onBackward}
          className='rounded-full p-1 transition-transform duration-200 hover:scale-105'
        >
          <MdFastRewind size={iconSize32} />
        </button>
        <button
          onClick={onTogglePlay}
          className='rounded-full p-1 transition-transform duration-200 hover:scale-105'
        >
          {isPlaying ? <MdOutlinePause size={iconSize48} /> : <MdPlayArrow size={iconSize48} />}
        </button>
        <button
          onClick={onForward}
          className='rounded-full p-1 transition-transform duration-200 hover:scale-105'
        >
          <MdFastForward size={iconSize32} />
        </button>
      </div>
    </div>
  );
};

export default TTSBar;
