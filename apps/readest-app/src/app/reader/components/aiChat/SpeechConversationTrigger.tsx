import clsx from 'clsx';
import React from 'react';
import { IoMic } from 'react-icons/io5';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';

interface SpeechConversationTriggerProps {
  onClick: () => void;
  disabled?: boolean;
}

const SpeechConversationTrigger: React.FC<SpeechConversationTriggerProps> = ({
  onClick,
  disabled = false,
}) => {
  const _ = useTranslation();
  const iconSize = useResponsiveSize(24);

  return (
    <div className='flex h-full items-center justify-center'>
      <button
        className={clsx('btn btn-primary btn-circle h-20 w-20', disabled && 'btn-disabled')}
        onClick={onClick}
        disabled={disabled}
        title={_('Start voice conversation')}
        aria-label={_('Start voice conversation')}
      >
        <IoMic size={iconSize} />
      </button>
    </div>
  );
};

export default SpeechConversationTrigger;
