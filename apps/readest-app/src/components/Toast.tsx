import clsx from 'clsx';
import React, { useEffect, useRef, useState } from 'react';
import { useThemeStore } from '@/store/themeStore';
import { eventDispatcher } from '@/utils/event';

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export const Toast = () => {
  const { safeAreaInsets } = useThemeStore();
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<ToastType>('info');
  const [toastTimeout, setToastTimeout] = useState(5000);
  const [messageClass, setMessageClass] = useState('');
  const [isVisible, setIsVisible] = useState(false);
  const toastDismissTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toastClassMap = {
    info: 'toast-info toast-center toast-middle',
    success: 'toast-success toast-top sm:toast-end toast-center',
    warning: 'toast-warning toast-top sm:toast-end toast-center',
    error: 'toast-error toast-top sm:toast-end toast-center',
  };

  const alertClassMap = {
    info: 'alert-primary border-base-300',
    success: 'alert-success not-eink:from-green-500 not-eink:to-emerald-500',
    warning: 'alert-warning not-eink:from-amber-500 not-eink:to-orange-500',
    error: 'alert-error not-eink:from-red-500 not-eink:to-rose-500',
  };

  const iconMap = {
    info: (
      <svg className='h-5 w-5' fill='currentColor' viewBox='0 0 20 20'>
        <path
          fillRule='evenodd'
          d='M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z'
          clipRule='evenodd'
        />
      </svg>
    ),
    success: (
      <svg className='h-5 w-5' fill='currentColor' viewBox='0 0 20 20'>
        <path
          fillRule='evenodd'
          d='M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z'
          clipRule='evenodd'
        />
      </svg>
    ),
    warning: (
      <svg className='h-5 w-5' fill='currentColor' viewBox='0 0 20 20'>
        <path
          fillRule='evenodd'
          d='M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z'
          clipRule='evenodd'
        />
      </svg>
    ),
    error: (
      <svg className='h-5 w-5' fill='currentColor' viewBox='0 0 20 20'>
        <path
          fillRule='evenodd'
          d='M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z'
          clipRule='evenodd'
        />
      </svg>
    ),
  };

  useEffect(() => {
    if (toastMessage) {
      setTimeout(() => {
        setIsVisible(true);
      }, 0);
    }
  }, [toastMessage]);

  useEffect(() => {
    if (toastDismissTimeout.current) clearTimeout(toastDismissTimeout.current);
    if (toastMessage) {
      const timeout = setTimeout(() => {
        setIsVisible(false);
        setTimeout(() => setToastMessage(''), 300);
      }, toastTimeout);
      toastDismissTimeout.current = timeout;
      return () => {
        if (timeout) clearTimeout(timeout);
      };
    }
    return;
  }, [toastMessage, toastTimeout]);

  const handleShowToast = async (event: CustomEvent) => {
    const { message, type = 'info', timeout, className = '', callback = null } = event.detail;
    setToastMessage(message);
    setToastType(type);
    if (timeout) setToastTimeout(timeout);
    if (callback && typeof callback === 'function') {
      setTimeout(() => callback(), timeout || 5000);
    }
    setMessageClass(className);
  };

  useEffect(() => {
    eventDispatcher.on('toast', handleShowToast);
    return () => {
      eventDispatcher.off('toast', handleShowToast);
    };
  }, []);

  const handleDismiss = () => {
    setIsVisible(false);
    setTimeout(() => setToastMessage(''), 300);
    if (toastDismissTimeout.current) clearTimeout(toastDismissTimeout.current);
  };

  return (
    toastMessage && (
      <div
        className={clsx(
          'toast z-50 w-auto max-w-screen-sm transition-all duration-300',
          toastClassMap[toastType],
          isVisible ? 'scale-100 opacity-100' : 'scale-95 opacity-0',
        )}
        style={{
          top: toastClassMap[toastType].includes('toast-top')
            ? `${(safeAreaInsets?.top || 0) + 44}px`
            : undefined,
        }}
      >
        <div
          className={clsx(
            'alert flex items-center gap-3 shadow-2xl backdrop-blur-sm',
            'min-h-0 rounded-2xl px-5 py-4',
            'not-eink:bg-gradient-to-r border-0',
            alertClassMap[toastType],
            'eink:bg-base-100 eink:border eink:border-base-content',
            toastType !== 'info' && 'text-white',
          )}
        >
          {/* Icon */}
          <div className='flex-shrink-0'>{iconMap[toastType]}</div>

          {/* Message */}
          <span
            className={clsx(
              'max-h-[50vh] flex-1 overflow-y-auto',
              'font-sans text-base font-medium leading-snug sm:text-sm',
              toastType === 'info'
                ? 'max-w-[60vw] truncate sm:max-w-[80vw]'
                : 'min-w-[60vw] max-w-[80vw] whitespace-normal break-words sm:min-w-40 sm:max-w-80',
              messageClass,
            )}
          >
            {toastMessage.split('\n').map((line, idx) => (
              <React.Fragment key={idx}>
                {line || <>&nbsp;</>}
                {idx < toastMessage.split('\n').length - 1 && <br />}
              </React.Fragment>
            ))}
          </span>

          {/* Close button */}
          <button
            onClick={handleDismiss}
            className={clsx(
              'flex-shrink-0 rounded-lg p-1 transition-colors',
              toastType === 'info' ? 'hover:bg-base-300' : 'hover:bg-white/20 active:bg-white/30',
            )}
            aria-label='Dismiss'
          >
            <svg className='h-4 w-4' fill='currentColor' viewBox='0 0 20 20'>
              <path
                fillRule='evenodd'
                d='M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z'
                clipRule='evenodd'
              />
            </svg>
          </button>
        </div>
      </div>
    )
  );
};
