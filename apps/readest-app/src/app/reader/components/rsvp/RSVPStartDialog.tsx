'use client';

import React from 'react';
import { RsvpStartChoice } from '@/services/rsvp';
import { useThemeStore } from '@/store/themeStore';
import { useTranslation } from '@/hooks/useTranslation';
import { IoBookmark, IoPlayCircle, IoLocation, IoText } from 'react-icons/io5';

interface RSVPStartDialogProps {
  startChoice: RsvpStartChoice;
  onSelect: (option: 'beginning' | 'saved' | 'current' | 'selection') => void;
  onClose: () => void;
}

const RSVPStartDialog: React.FC<RSVPStartDialogProps> = ({ startChoice, onSelect, onClose }) => {
  const _ = useTranslation();
  const { themeCode, isDarkMode } = useThemeStore();

  // Use theme colors directly from themeCode (bg, fg, primary are already resolved from palette)
  // For dialog, use a slightly different background using palette['base-200'] or darken/lighten the bg
  const bgColor = themeCode.palette['base-200'] || themeCode.bg;
  const fgColor = themeCode.fg;
  const accentColor = themeCode.primary;
  const backdropColor = isDarkMode ? 'rgba(0, 0, 0, 0.75)' : 'rgba(0, 0, 0, 0.6)';

  return (
    <div
      className='fixed inset-0 z-[10001] flex items-center justify-center'
      style={{ backgroundColor: backdropColor }}
      onClick={onClose}
    >
      <div
        className='mx-4 w-full max-w-md rounded-2xl p-6 shadow-2xl'
        style={{ backgroundColor: bgColor, color: fgColor, opacity: 1 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className='mb-2 text-xl font-bold'>{_('Start RSVP Reading')}</h2>
        <p className='mb-6 text-sm opacity-70'>{_('Choose where to start reading')}</p>

        <div className='flex flex-col gap-3'>
          {/* Start from beginning */}
          <button
            className='flex cursor-pointer items-center gap-4 rounded-xl border-none bg-gray-500/10 px-4 py-4 text-left transition-colors hover:bg-gray-500/20'
            style={{ color: 'inherit' }}
            onClick={() => onSelect('beginning')}
          >
            <div
              className='flex h-10 w-10 items-center justify-center rounded-full'
              style={{ backgroundColor: `${accentColor}20`, color: accentColor }}
            >
              <IoPlayCircle size={24} />
            </div>
            <div>
              <div className='font-semibold'>{_('From Chapter Start')}</div>
              <div className='text-sm opacity-60'>
                {_('Start reading from the beginning of the chapter')}
              </div>
            </div>
          </button>

          {/* Resume from saved position */}
          {startChoice.hasSavedPosition && (
            <button
              className='flex cursor-pointer items-center gap-4 rounded-xl border-none bg-gray-500/10 px-4 py-4 text-left transition-colors hover:bg-gray-500/20'
              style={{ color: 'inherit' }}
              onClick={() => onSelect('saved')}
            >
              <div
                className='flex h-10 w-10 items-center justify-center rounded-full'
                style={{ backgroundColor: `${accentColor}20`, color: accentColor }}
              >
                <IoBookmark size={24} />
              </div>
              <div>
                <div className='font-semibold'>{_('Resume')}</div>
                <div className='text-sm opacity-60'>{_('Continue from where you left off')}</div>
              </div>
            </button>
          )}

          {/* Start from current position */}
          <button
            className='flex cursor-pointer items-center gap-4 rounded-xl border-none bg-gray-500/10 px-4 py-4 text-left transition-colors hover:bg-gray-500/20'
            style={{ color: 'inherit' }}
            onClick={() => onSelect('current')}
          >
            <div
              className='flex h-10 w-10 items-center justify-center rounded-full'
              style={{ backgroundColor: `${accentColor}20`, color: accentColor }}
            >
              <IoLocation size={24} />
            </div>
            <div>
              <div className='font-semibold'>{_('From Current Page')}</div>
              <div className='text-sm opacity-60'>
                {_('Start from where you are currently reading')}
              </div>
            </div>
          </button>

          {/* Start from selection */}
          {startChoice.hasSelection && startChoice.selectionText && (
            <button
              className='flex cursor-pointer items-center gap-4 rounded-xl border-none bg-gray-500/10 px-4 py-4 text-left transition-colors hover:bg-gray-500/20'
              style={{ color: 'inherit' }}
              onClick={() => onSelect('selection')}
            >
              <div
                className='flex h-10 w-10 items-center justify-center rounded-full'
                style={{ backgroundColor: `${accentColor}20`, color: accentColor }}
              >
                <IoText size={24} />
              </div>
              <div>
                <div className='font-semibold'>{_('From Selection')}</div>
                <div className='max-w-[250px] truncate text-sm opacity-60'>
                  &quot;{startChoice.selectionText.substring(0, 50)}
                  {startChoice.selectionText.length > 50 ? '...' : ''}&quot;
                </div>
              </div>
            </button>
          )}
        </div>

        {/* Cancel button */}
        <button
          className='mt-6 w-full cursor-pointer rounded-xl border border-gray-500/30 bg-transparent px-4 py-3 font-medium transition-colors hover:bg-gray-500/10'
          style={{ color: 'inherit' }}
          onClick={onClose}
        >
          {_('Cancel')}
        </button>
      </div>
    </div>
  );
};

export default RSVPStartDialog;
