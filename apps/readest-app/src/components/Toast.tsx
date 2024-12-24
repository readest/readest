import clsx from 'clsx';
import React from 'react';

const Toast: React.FC<{ message: string; toastClass?: string; alertClass?: string }> = ({
  message,
  toastClass,
  alertClass,
}) => (
  <div className={clsx('toast toast-center toast-middle', toastClass)}>
    <div className={clsx('alert flex items-center justify-center border-0', alertClass)}>
      <span>{message}</span>
    </div>
  </div>
);

export default Toast;
