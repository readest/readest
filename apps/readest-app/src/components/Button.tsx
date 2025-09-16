import clsx from 'clsx';
import React from 'react';
import { useEnv } from '@/context/EnvContext';

interface ButtonProps {
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  label?: string;
  className?: string;
}

const Button: React.FC<ButtonProps> = ({ icon, onClick, disabled = false, label, className }) => {
  const { appService } = useEnv();
  return (
    <button
      className={clsx(
        'btn btn-ghost h-8 min-h-8 w-8 p-0',
        appService?.isMobileApp && 'hover:bg-transparent',
        disabled && 'cursor-default !bg-transparent opacity-50',
        className,
      )}
      title={label}
      aria-label={label}
      onClick={disabled ? undefined : onClick}
    >
      {icon}
    </button>
  );
};

export default Button;
