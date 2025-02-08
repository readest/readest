import clsx from 'clsx';
import React, { ReactNode, useEffect } from 'react';
import { MdArrowBackIosNew } from 'react-icons/md';
import { useEnv } from '@/context/EnvContext';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';

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
  const iconSize22 = useResponsiveSize(22);
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

  return (
    <dialog
      id={id ?? 'dialog'}
      open={isOpen}
      className={clsx(
        'modal sm:min-w-90 z-50 h-full w-full !bg-[rgba(0,0,0,0.2)] sm:w-full',
        className,
      )}
    >
      <div
        className={clsx(
          'modal-box settings-content flex h-full max-h-full w-full max-w-full flex-col rounded-none p-0 sm:rounded-2xl',
          'sm:h-[60%] sm:w-[65%] sm:max-w-[600px]',
          appService?.hasSafeAreaInset && 'pt-[env(safe-area-inset-top)]',
          boxClassName,
        )}
      >
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
