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
  const toastDismissTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toastClassMap = {
    info: 'toast-info toast-center toast-middle',
    success: 'toast-success toast-top sm:toast-end toast-center',
    warning: 'toast-warning toast-top sm:toast-end toast-center',
    error: 'toast-error toast-top sm:toast-end toast-center',
  };

  const alertClassMap = {
    info: 'alert-primary border-base-300',
    success: 'alert-success border-0',
    warning: 'alert-warning border-0',
    error: 'alert-error border-0',
  };

  useEffect(() => {
    if (toastDismissTimeout.current) clearTimeout(toastDismissTimeout.current);
    const timeout = setTimeout(() => setToastMessage(''), toastTimeout);
    toastDismissTimeout.current = timeout;

    return () => {
      if (timeout) clearTimeout(timeout);
    };
  }, [toastMessage, toastTimeout]);

  const handleShowToast = async (event: CustomEvent) => {
    const { message, type = 'info', timeout, className = '' } = event.detail;
    setToastMessage(message);
    setToastType(type);
    if (timeout) setToastTimeout(timeout);
    setMessageClass(className);
  };

  useEffect(() => {
    eventDispatcher.on('toast', handleShowToast);
    return () => {
      eventDispatcher.off('toast', handleShowToast);
    };
  }, []);

  return (
    toastMessage && (
      <div
        className={clsx(
          'toast toast-center toast-middle z-50 w-auto max-w-screen-sm',
          toastClassMap[toastType],
        )}
        style={{
          top: toastClassMap[toastType].includes('toast-top')
            ? `${(safeAreaInsets?.top || 0) + 44}px`
            : undefined,
        }}
      >
        <div className={clsx('alert flex items-center justify-center', alertClassMap[toastType])}>
          <span
            className={clsx(
              'max-h-[50vh] min-w-32 overflow-y-auto',
              'text-center font-sans text-base font-normal sm:text-sm',
              toastType === 'info'
                ? 'max-w-[80vw]'
                : 'min-w-[60vw] max-w-[80vw] whitespace-normal break-words sm:min-w-40 sm:max-w-80',
              messageClass,
            )}
          >
            {toastMessage.split('\n').map((line, idx) => (
              <React.Fragment key={idx}>
                {line || <>&nbsp;</>}
                <br />
              </React.Fragment>
            ))}
          </span>
        </div>
      </div>
    )
  );
};
