import clsx from 'clsx';
import React from 'react';
import { useEnv } from '@/context/EnvContext';

interface ButtonProps {
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tooltip?: string;
  tooltipDirection?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}

const Button: React.FC<ButtonProps> = ({ icon, onClick, disabled = false, tooltip, className }) => {
  const { appService } = useEnv();
  return (
    <button
      className={clsx(
        'btn btn-ghost h-8 min-h-8 w-8 p-0',
        appService?.isMobileApp && 'hover:bg-transparent',
        disabled && 'btn-disabled !bg-transparent opacity-50',
        className,
      )}
      title={tooltip}
      aria-label={tooltip}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
    >
      {icon}
    </button>
  );
};

export default Button;
