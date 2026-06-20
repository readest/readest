import clsx from 'clsx';
import React, { ReactNode } from 'react';
import ReactDOM from 'react-dom';

interface ModalPortalProps {
  children: ReactNode;
  showOverlay?: boolean;
}

// Coordinated overlay z-index scale (all clear the desktop `.window-border`
// page frame at z-99 — see globals.css). Low -> high:
//   100 RSVP overlay · 101 RSVP controls · 110 Settings dialog ·
//   120 modal / command palette · 130 toast · 200 app-lock.
// ModalPortal is the top modal layer, so it sits above the Settings dialog —
// a modal opened from inside Settings (e.g. Add OPDS Catalog) must win.
// Invariants are enforced by src/__tests__/styles/zIndexScale.test.ts.
const ModalPortal: React.FC<ModalPortalProps> = ({ children, showOverlay = true }) => {
  return ReactDOM.createPortal(
    <div
      className={clsx(
        'fixed inset-0 isolate z-[120] flex items-center justify-center',
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
