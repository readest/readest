import clsx from 'clsx';
import React from 'react';
import { IoStop } from 'react-icons/io5';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';

interface SpeechConversationStatusProps {
  isRecording: boolean;
  onStop: () => void;
}

const SpeechConversationStatus: React.FC<SpeechConversationStatusProps> = ({
  isRecording,
  onStop,
}) => {
  const _ = useTranslation();
  const iconSize = useResponsiveSize(18);

  return (
    <div className='flex flex-col items-center justify-center gap-4 py-4'>
      {isRecording && (
        <div className='flex items-center gap-2'>
          <span className='relative flex h-3 w-3'>
            <span className='bg-error absolute inline-flex h-full w-full animate-ping rounded-full opacity-75'></span>
            <span className='bg-error relative inline-flex h-3 w-3 rounded-full'></span>
          </span>
          <span className='text-sm'>{_('Listening...')}</span>
        </div>
      )}
      <button
        className={clsx(
          'btn btn-error btn-sm',
          !isRecording && 'btn-outline',
        )}
        onClick={onStop}
        title={_('Stop voice conversation')}
        aria-label={_('Stop voice conversation')}
      >
        <IoStop size={iconSize} />
        <span>{_('Stop')}</span>
      </button>
    </div>
  );
};

export default SpeechConversationStatus;

