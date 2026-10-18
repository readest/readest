import clsx from 'clsx';
import React, { useEffect, useRef } from 'react';
import { useEnv } from '@/context/EnvContext';

import { tauriHandleMinimize, tauriHandleToggleMaximize, tauriHandleClose } from '@/utils/window';
import { isTauriAppPlatform, needsPointerWindowControls } from '@/services/environment';
import { startPointerWindowMove } from '@/utils/windowPointerDrag';
import { useTranslation } from '@/hooks/useTranslation';

const DRAG_INPUT_THRESHOLD = 4;

interface WindowButtonsProps {
  className?: string;
  headerRef?: React.RefObject<HTMLElement | null>;
  showMinimize?: boolean;
  showMaximize?: boolean;
  showClose?: boolean;
  closeButtonLabel?: string;
  onMinimize?: () => void;
  onToggleMaximize?: () => void;
  onClose?: () => void;
}

interface WindowButtonProps {
  id: string;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}

const WindowButton: React.FC<WindowButtonProps> = ({ onClick, label, id, children }) => (
  <button
    id={id}
    onClick={onClick}
    className='window-button bg-base-200/35 hover:bg-base-200 text-base-content/85 hover:text-base-content'
    aria-label={label}
  >
    {children}
  </button>
);

const WindowButtons: React.FC<WindowButtonsProps> = ({
  className,
  headerRef,
  showMinimize = true,
  showMaximize = true,
  showClose = true,
  closeButtonLabel,
  onMinimize,
  onToggleMaximize,
  onClose,
}) => {
  const _ = useTranslation();
  const parentRef = useRef<HTMLDivElement>(null);
  const { appService } = useEnv();

  const touchState = useRef({
    lastPointerTime: 0,
    pointerStartPosition: { x: 0, y: 0 },
    isDragging: false,
  });

  const isExcludedElement = (target: HTMLElement) => {
    return (
      target.closest('.btn') ||
      target.closest('.window-button') ||
      target.closest('.dropdown-container') ||
      target.closest('.exclude-title-bar-mousedown')
    );
  };

  const startWindowMove = async (e: MouseEvent) => {
    if (needsPointerWindowControls()) {
      startPointerWindowMove(e);
    } else {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      getCurrentWindow().startDragging();
    }
  };

  // An unfocused title-bar search field drags the window like the bar around
  // it; a click without movement focuses it, and once focused it selects text.
  const handleDragInputMouseDown = (input: HTMLInputElement, e: MouseEvent) => {
    e.preventDefault();
    const onMove = (move: MouseEvent) => {
      // The release was missed (e.g. outside the window): drop the press.
      if ((move.buttons & 1) === 0) {
        stop();
        return;
      }
      const dx = Math.abs(move.screenX - e.screenX);
      const dy = Math.abs(move.screenY - e.screenY);
      if (dx > DRAG_INPUT_THRESHOLD || dy > DRAG_INPUT_THRESHOLD) {
        stop();
        startWindowMove(e);
      }
    };
    const onUp = () => {
      stop();
      input.focus();
    };
    const stop = () => {
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mouseup', onUp, true);
      window.removeEventListener('blur', stop);
    };
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup', onUp, true);
    // Losing focus mid-press (e.g. Alt+Tab) can swallow the release.
    window.addEventListener('blur', stop);
  };

  const handleMouseDown = async (e: MouseEvent) => {
    const target = e.target as HTMLElement;

    if (
      e.buttons === 1 &&
      target instanceof HTMLInputElement &&
      target.classList.contains('window-drag-input') &&
      !target.disabled &&
      document.activeElement !== target
    ) {
      handleDragInputMouseDown(target, e);
      return;
    }

    if (isExcludedElement(target)) {
      return;
    }

    if (e.buttons === 1) {
      if (e.detail === 2) {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        getCurrentWindow().toggleMaximize();
      } else {
        startWindowMove(e);
      }
    }
  };

  const handlePointerDown = async (e: PointerEvent) => {
    const target = e.target as HTMLElement;

    if (isExcludedElement(target)) {
      return;
    }

    if (e.pointerType === 'mouse') {
      return;
    }

    e.preventDefault();

    const currentTime = Date.now();
    const timeDiff = currentTime - touchState.current.lastPointerTime;

    touchState.current.pointerStartPosition = {
      x: e.clientX,
      y: e.clientY,
    };

    if (timeDiff < 300) {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      getCurrentWindow().toggleMaximize();
      return;
    }

    touchState.current.lastPointerTime = currentTime;
    touchState.current.isDragging = false;
  };

  const handlePointerMove = async (e: PointerEvent) => {
    const target = e.target as HTMLElement;

    if (isExcludedElement(target) || touchState.current.isDragging) {
      return;
    }

    if (e.pointerType === 'mouse') {
      return;
    }

    e.preventDefault();

    const deltaX = Math.abs(e.clientX - touchState.current.pointerStartPosition.x);
    const deltaY = Math.abs(e.clientY - touchState.current.pointerStartPosition.y);

    if (deltaX > 5 || deltaY > 5) {
      touchState.current.isDragging = true;
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().startDragging();
      } catch (error) {
        console.warn('Failed to start window dragging:', error);
      }
    }
  };

  const handlePointerUp = () => {
    touchState.current.isDragging = false;
  };

  useEffect(() => {
    if (!isTauriAppPlatform() || !appService?.hasWindowBar) return;
    const headerElement = headerRef?.current;
    if (!headerElement) return;

    // Lets CSS style a window-drag-input only where it really drags the window.
    headerElement.setAttribute('data-window-drag', '');
    headerElement.addEventListener('mousedown', handleMouseDown);
    headerElement.addEventListener('pointerdown', handlePointerDown);
    headerElement.addEventListener('pointermove', handlePointerMove);
    headerElement.addEventListener('pointerup', handlePointerUp);
    headerElement.addEventListener('pointercancel', handlePointerUp);

    return () => {
      headerElement.removeAttribute('data-window-drag');
      headerElement.removeEventListener('mousedown', handleMouseDown);
      headerElement.removeEventListener('pointerdown', handlePointerDown);
      headerElement.removeEventListener('pointermove', handlePointerMove);
      headerElement.removeEventListener('pointerup', handlePointerUp);
      headerElement.removeEventListener('pointercancel', handlePointerUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appService?.hasWindowBar, headerRef]);

  const handleMinimize = async () => {
    if (onMinimize) {
      onMinimize();
    } else {
      tauriHandleMinimize();
    }
  };

  const handleMaximize = async () => {
    if (onToggleMaximize) {
      onToggleMaximize();
    } else {
      tauriHandleToggleMaximize();
    }
  };

  const handleClose = async () => {
    if (onClose) {
      onClose();
    } else {
      tauriHandleClose();
    }
  };

  return (
    <div
      ref={parentRef}
      className={clsx(
        'window-buttons flex h-8 items-center justify-end space-x-2',
        showClose || showMaximize || showMinimize ? 'visible' : 'hidden',
        className,
      )}
    >
      {showMinimize && appService?.hasWindowBar && (
        <WindowButton onClick={handleMinimize} label={_('Minimize')} id='titlebar-minimize'>
          <svg xmlns='http://www.w3.org/2000/svg' width='1em' height='1em' viewBox='0 0 24 24'>
            <path fill='currentColor' d='M20 14H4v-2h16' />
          </svg>
        </WindowButton>
      )}

      {showMaximize && appService?.hasWindowBar && (
        <WindowButton
          onClick={handleMaximize}
          label={_('Maximize or Restore')}
          id='titlebar-maximize'
        >
          <svg xmlns='http://www.w3.org/2000/svg' width='1em' height='1em' viewBox='0 0 24 24'>
            <path fill='currentColor' d='M4 4h16v16H4zm2 4v10h12V8z' />
          </svg>
        </WindowButton>
      )}

      {showClose && (appService?.hasWindowBar || onClose) && (
        <WindowButton
          onClick={handleClose}
          label={closeButtonLabel || _('Close')}
          id='titlebar-close'
        >
          <svg xmlns='http://www.w3.org/2000/svg' width='1em' height='1em' viewBox='0 0 24 24'>
            <path
              fill='currentColor'
              d='M19 6.41L17.59 5L12 10.59L6.41 5L5 6.41L10.59 12L5 17.59L6.41 19L12 13.41L17.59 19L19 17.59L13.41 12z'
            />
          </svg>
        </WindowButton>
      )}
    </div>
  );
};

export default WindowButtons;
