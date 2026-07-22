import clsx from 'clsx';
import React from 'react';

interface OverlayProps {
  onDismiss: () => void;
  dismissLabel?: string;
  className?: string;
  /** Whether this mounted layer covers reader pixels and blocks native capture. */
  captureBlocking?: boolean;
}

export const Overlay: React.FC<OverlayProps> = ({
  onDismiss,
  className,
  captureBlocking = true,
}) => {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onDismiss();
    }
  };

  return (
    <div
      data-capture-blocking-overlay={captureBlocking ? 'true' : undefined}
      className={clsx('overlay fixed inset-0 cursor-default', className)}
      role='none'
      tabIndex={-1}
      onClick={onDismiss}
      onContextMenu={onDismiss}
      onKeyDown={handleKeyDown}
    />
  );
};
