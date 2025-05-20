import React, { ReactNode } from 'react';
import ReactDOM from 'react-dom';

interface ModalPortalProps {
  children: ReactNode;
}

const ModalPortal: React.FC<ModalPortalProps> = ({ children }) => {
  return ReactDOM.createPortal(
    <div
      className='fixed inset-0 isolate z-50 flex items-center justify-center bg-black bg-opacity-50'
      style={{ transform: 'translateZ(0)' }}
    >
      {children}
    </div>,
    document.body,
  );
};

export default ModalPortal;
