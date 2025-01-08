import { eventDispatcher } from '@/utils/event';
import clsx from 'clsx';
import React, { useEffect, useRef, useState } from 'react';

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export const Toast = () => {
  const [toastMessage, setToastMessage] = useState('');
  const toastType = useRef<ToastType>('info');
  const toastTimeout = useRef(5000);
  const messageClass = useRef('');
  const toastDismissTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastClassMap = {
    info: 'toast-info toast-center toast-middle',
    success: 'toast-success toast-top toast-end pt-11',
    warning: 'toast-warning toast-top toast-end pt-11',
    error: 'toast-error toast-top toast-end pt-11',
  };
  const alertClassMap = {
    info: 'alert-primary',
    success: 'alert-success',
    warning: 'alert-warning',
    error: 'alert-error',
  };

  useEffect(() => {
    if (toastDismissTimeout.current) clearTimeout(toastDismissTimeout.current);
    toastDismissTimeout.current = setTimeout(() => setToastMessage(''), toastTimeout.current);
    return () => {
      if (toastDismissTimeout.current) clearTimeout(toastDismissTimeout.current);
    };
  }, [toastMessage]);

  const handleShowToast = async (event: CustomEvent) => {
    const { message, type = 'info', timeout = 5000, className = '' } = event.detail;
    setToastMessage(message);
    toastType.current = type;
    toastTimeout.current = timeout;
    messageClass.current = className;
  };

  useEffect(() => {
    eventDispatcher.on('toast', handleShowToast);
    return () => {
      eventDispatcher.off('toast', handleShowToast);
    };
  }, []);

  return (
    toastMessage && (
      <div className={clsx('toast toast-center toast-middle', toastClassMap[toastType.current])}>
        <div
          className={clsx(
            'alert flex max-w-80 items-center justify-center border-0',
            alertClassMap[toastType.current],
          )}
        >
          <span className={clsx('whitespace-normal break-words', messageClass.current)}>
            {toastMessage}
          </span>
        </div>
      </div>
    )
  );
};
