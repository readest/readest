import clsx from 'clsx';
import React from 'react';
import { useTranslation } from '@/hooks/useTranslation';

interface OverlayProps {
  onDismiss: () => void;
  dismissLabel?: string;
  className?: string;
}

export const Overlay: React.FC<OverlayProps> = ({ onDismiss, dismissLabel, className }) => {
  const _ = useTranslation();

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onDismiss();
    }
  };

  return (
    <div
      className={clsx('overlay fixed inset-0 cursor-default', className)}
      role='button'
      tabIndex={-1}
      aria-label={dismissLabel || _('Dismiss')}
      onClick={onDismiss}
      onContextMenu={onDismiss}
      onKeyDown={handleKeyDown}
    />
  );
};
