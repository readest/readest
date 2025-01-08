import React, { useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { MdPlayCircle, MdPauseCircle, MdFastRewind, MdFastForward, MdStop } from 'react-icons/md';

type TTSPanelProps = {
  isPlaying: boolean;
  onTogglePlay: () => void;
  onBackward: () => void;
  onForward: () => void;
  onStop: () => void;
  onSetRate: (rate: number) => void;
};

const TTSPanel = ({
  isPlaying,
  onTogglePlay,
  onBackward,
  onForward,
  onStop,
  onSetRate,
}: TTSPanelProps) => {
  const _ = useTranslation();
  const [rate, setRate] = useState(1.0);

  return (
    <div className='flex w-full flex-col items-center justify-center gap-2 rounded-2xl p-4'>
      <div className='flex w-full flex-col items-center gap-0.5'>
        <input
          type='range'
          min={0.5}
          max={3}
          value={rate}
          className='range'
          step='0.1'
          onChange={(e) => {
            const newRate = parseFloat(e.target.value);
            setRate(newRate);
            onSetRate(newRate);
          }}
        />
        <div className='grid w-full grid-cols-7 text-xs'>
          <span className='text-center'>|</span>
          <span className='text-center'>|</span>
          <span className='text-center'>|</span>
          <span className='text-center'>|</span>
          <span className='text-center'>|</span>
          <span className='text-center'>|</span>
          <span className='text-center'>|</span>
        </div>
        <div className='grid w-full grid-cols-7 text-xs'>
          <span className='text-center'>{_('Slow')}</span>
          <span className='text-center'></span>
          <span className='text-center'>1.0</span>
          <span className='text-center'>1.5</span>
          <span className='text-center'>2.0</span>
          <span className='text-center'></span>
          <span className='text-center'>{_('Fast')}</span>
        </div>
      </div>
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
