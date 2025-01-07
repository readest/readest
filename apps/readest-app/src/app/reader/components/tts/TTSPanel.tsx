import React from 'react';
import { MdPlayCircle, MdPauseCircle, MdFastRewind, MdFastForward, MdStop } from 'react-icons/md';

type TTSPanelProps = {
  isPlaying: boolean;
  onTogglePlay: () => void;
  onBackward: () => void;
  onForward: () => void;
  onStop: () => void;
};

const TTSPanel = ({ isPlaying, onTogglePlay, onBackward, onForward, onStop }: TTSPanelProps) => {
  return (
    <div className='flex w-full items-center justify-center rounded-2xl p-4'>
      <div className='flex items-center justify-between space-x-4'>
        <button onClick={onBackward} className='hover:bg-base-200/75 rounded-full p-1'>
          <MdFastRewind size={32} />
        </button>
        <button onClick={onTogglePlay} className='hover:bg-base-200/75 rounded-full p-1'>
          {isPlaying ? (
            <MdPauseCircle size={48} className='fill-primary' />
          ) : (
            <MdPlayCircle size={48} className='fill-primary' />
          )}
        </button>
        <button onClick={onForward} className='hover:bg-base-200/75 rounded-full p-1'>
          <MdFastForward size={32} />
        </button>
        <button onClick={onStop} className='hover:bg-base-200/75 rounded-full p-1'>
          <MdStop size={32} />
        </button>
      </div>
    </div>
  );
};

export default TTSPanel;
