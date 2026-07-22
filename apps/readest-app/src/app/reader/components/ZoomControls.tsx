import React from 'react';
import {
  IoClose,
  IoExpand,
  IoAdd,
  IoRemove,
  IoShareOutline,
  IoDownloadOutline,
} from 'react-icons/io5';
import { useTranslation } from '@/hooks/useTranslation';
import { useThemeStore } from '@/store/themeStore';
import { Insets } from '@/types/misc';

interface ZoomControlsProps {
  gridInsets: Insets;
  // Save/Share is image-specific; omit `onSave` (e.g. the table viewer) to hide it.
  canShare?: boolean;
  onClose: () => void;
  onSave?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}

const ZoomControls: React.FC<ZoomControlsProps> = ({
  gridInsets,
  canShare,
  onClose,
  onSave,
  onZoomIn,
  onZoomOut,
  onReset,
}) => {
  const _ = useTranslation();
  const { systemUIVisible, statusBarHeight } = useThemeStore();
  return (
    <div
      className='absolute right-4 top-2 z-10 grid grid-cols-1 gap-4 text-white'
      style={{
        marginTop: systemUIVisible
          ? `${Math.max(gridInsets.top, statusBarHeight)}px`
          : `${gridInsets.top}px`,
      }}
    >
      <button
        onClick={onClose}
        className='eink-bordered flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-black/50 transition-colors hover:bg-black/70'
        aria-label={_('Close')}
        title={_('Close')}
      >
        <IoClose className='h-6 w-6' />
      </button>

      {onSave && (
        <button
          onClick={onSave}
          className='eink-bordered flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-black/50 transition-colors hover:bg-black/70'
          aria-label={canShare ? _('Share Image') : _('Save Image')}
          title={canShare ? _('Share Image') : _('Save Image')}
        >
          {canShare ? (
            <IoShareOutline className='h-6 w-6' />
          ) : (
            <IoDownloadOutline className='h-6 w-6' />
          )}
        </button>
      )}

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
