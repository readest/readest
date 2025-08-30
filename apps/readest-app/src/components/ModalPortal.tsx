import clsx from 'clsx';
import React, { ReactNode } from 'react';
import ReactDOM from 'react-dom';

interface ModalPortalProps {
  children: ReactNode;
  showOverlay?: boolean;
}

const ModalPortal: React.FC<ModalPortalProps> = ({ children, showOverlay = true }) => {
  return ReactDOM.createPortal(
    <div
      className={clsx(
        'fixed inset-0 isolate z-[100] flex items-center justify-center',
        showOverlay && 'bg-black bg-opacity-50',
      )}
      style={{ transform: 'translateZ(0)' }}
    >
      {children}
    </div>,
    document.body,
  );
};

export default ModalPortal;
