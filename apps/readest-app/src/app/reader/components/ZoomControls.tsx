import React from 'react';
import { IoClose, IoExpand, IoAdd, IoRemove } from 'react-icons/io5';
import { useTranslation } from '@/hooks/useTranslation';

interface ZoomControlsProps {
  onClose: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}

const ZoomControls: React.FC<ZoomControlsProps> = ({ onClose, onZoomIn, onZoomOut, onReset }) => {
  const _ = useTranslation();
  return (
    <div className='absolute right-4 top-4 z-10 grid grid-cols-1 gap-4 text-white'>
      <button
        onClick={onClose}
        className='eink-bordered flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-black/50 transition-colors hover:bg-black/70'
        aria-label={_('Close')}
        title={_('Close')}
      >
        <IoClose className='h-6 w-6' />
      </button>

      <button
        onClick={onZoomIn}
        className='eink-bordered flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-black/50 transition-colors hover:bg-black/70'
        aria-label={_('Zoom In')}
        title={_('Zoom In')}
      >
        <IoAdd className='h-6 w-6' />
      </button>

      <button
        onClick={onZoomOut}
        className='eink-bordered flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-black/50 transition-colors hover:bg-black/70'
        aria-label={_('Zoom Out')}
        title={_('Zoom Out')}
      >
        <IoRemove className='h-6 w-6' />
      </button>

      <button
        onClick={onReset}
        className='eink-bordered flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-black/50 transition-colors hover:bg-black/70'
        aria-label={_('Reset Zoom')}
        title={_('Reset Zoom')}
      >
        <IoExpand className='h-6 w-6' />
      </button>
    </div>
  );
};

export default ZoomControls;
