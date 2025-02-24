import clsx from 'clsx';
import React, { ReactNode, useEffect, useState } from 'react';
import { MdArrowBackIosNew } from 'react-icons/md';
import { useEnv } from '@/context/EnvContext';
import { useDrag } from '@/hooks/useDrag';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { impactFeedback } from '@tauri-apps/plugin-haptics';

const DISMISS_THRESHOLD = 100;
const VELOCITY_THRESHOLD = 0.5;

interface DialogProps {
  id?: string;
  isOpen: boolean;
  children: ReactNode;
  header?: ReactNode;
  title?: string;
  className?: string;
  boxClassName?: string;
  contentClassName?: string;
  onClose: () => void;
}

const Dialog: React.FC<DialogProps> = ({
  id,
  isOpen,
  children,
  header,
  title,
  className,
  boxClassName,
  contentClassName,
  onClose,
}) => {
  const { appService } = useEnv();
  const [translateY, setTranslateY] = useState(0);
  const iconSize22 = useResponsiveSize(22);
  const isMobile = window.innerWidth < 640;

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      onClose();
    }
  };

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDragMove = (data: { clientY: number; deltaY: number }) => {
    if (!isMobile) return;

    const modal = document.querySelector('.modal-box') as HTMLElement;
    const overlay = document.querySelector('.overlay') as HTMLElement;
    if (modal && overlay) {
      modal.style.transition = '';
      overlay.style.opacity = `${1 - data.clientY / window.innerHeight}`;
    }
    setTranslateY((prev) => Math.max(prev + data.deltaY, 0));
  };

  const handleDragEnd = (velocity: number) => {
    const modal = document.querySelector('.modal-box') as HTMLElement;
    if (!modal) return;

    if (translateY > DISMISS_THRESHOLD || velocity > VELOCITY_THRESHOLD) {
      modal.style.transition = `transform ${0.15 / velocity}s ease-out`;
      onClose();
      setTimeout(() => setTranslateY(0), 300);
      if (appService?.hasHaptics) {
        impactFeedback('medium');
      }
    } else {
      modal.style.transition = `transform 0.3s ease-out`;
      setTranslateY(0);
      if (appService?.hasHaptics) {
        impactFeedback('medium');
      }
    }
  };

  const { handleDragStart } = useDrag(handleDragMove, handleDragEnd);

  return (
    <dialog
      id={id ?? 'dialog'}
      open={isOpen}
      className={clsx('modal sm:min-w-90 z-50 h-full w-full sm:w-full', className)}
    >
      <div className='overlay fixed inset-0 z-10 bg-black/30 sm:bg-black/20' />
      <div
        className={clsx(
          'modal-box settings-content z-20 flex flex-col rounded-none rounded-tl-2xl rounded-tr-2xl p-0 sm:rounded-2xl',
          'h-full max-h-full w-full max-w-full sm:w-[65%] sm:max-w-[600px]',
          appService?.hasSafeAreaInset && 'pt-[env(safe-area-inset-top)] sm:pt-0',
          boxClassName,
        )}
        style={{
          transform: `translateY(${translateY}px)`,
        }}
      >
        {window.innerWidth < 640 && (
          <div
            className='drag-handle flex h-10 w-full cursor-row-resize items-center justify-center'
            onMouseDown={handleDragStart}
            onTouchStart={handleDragStart}
          >
            <div className='bg-base-content/50 h-1 w-10 rounded-full'></div>
          </div>
        )}
        <div className='dialog-header bg-base-100 sticky top-1 z-10 flex items-center justify-between px-4'>
          {header ? (
            header
          ) : (
            <div className='flex h-11 w-full items-center justify-between'>
              <button
                tabIndex={-1}
                onClick={onClose}
                className={
                  'btn btn-ghost btn-circle flex h-6 min-h-6 w-6 hover:bg-transparent focus:outline-none sm:hidden'
                }
              >
                <MdArrowBackIosNew size={iconSize22} />
              </button>
              <div className='z-15 pointer-events-none absolute inset-0 flex h-11 items-center justify-center'>
                <span className='line-clamp-1 text-center font-bold'>{title ?? ''}</span>
              </div>
              <button
                tabIndex={-1}
                onClick={onClose}
                className={
                  'bg-base-300/65 btn btn-ghost btn-circle ml-auto hidden h-6 min-h-6 w-6 focus:outline-none sm:flex'
                }
              >
                <svg
                  xmlns='http://www.w3.org/2000/svg'
                  width='1em'
                  height='1em'
                  viewBox='0 0 24 24'
                >
                  <path
                    fill='currentColor'
                    d='M19 6.41L17.59 5L12 10.59L6.41 5L5 6.41L10.59 12L5 17.59L6.41 19L12 13.41L17.59 19L19 17.59L13.41 12z'
                  />
                </svg>
              </button>
            </div>
          )}
        </div>

        <div
          className={clsx(
            'text-base-content my-2 flex-grow overflow-y-auto px-6 sm:px-[10%]',
            contentClassName,
          )}
        >
          {children}
        </div>
      </div>
    </dialog>
  );
};

export default Dialog;
