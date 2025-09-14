import clsx from 'clsx';
import React from 'react';

interface OverlayProps {
  onDismiss: () => void;
  dismissLabel?: string;
  className?: string;
}

export const Overlay: React.FC<OverlayProps> = ({ onDismiss, className }) => {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onDismiss();
    }
  };

  return (
    <div
      className={clsx('overlay fixed inset-0 cursor-default', className)}
      role='none'
      tabIndex={-1}
      onClick={onDismiss}
      onContextMenu={onDismiss}
      onKeyDown={handleKeyDown}
    />
  );
};
