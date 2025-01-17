import React from 'react';
import clsx from 'clsx';

interface ButtonProps {
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tooltip?: string;
  tooltipDirection?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}

const Button: React.FC<ButtonProps> = ({
  icon,
  onClick,
  disabled = false,
  tooltip,
  tooltipDirection = 'top',
  className,
}) => {
  return (
    <div
      className={clsx(
        'lg:tooltip z-50 h-8 min-h-8 w-8',
        tooltip && `lg:tooltip-${tooltipDirection}`,
        {
          'tooltip-hidden': !tooltip,
        },
      )}
      data-tip={tooltip}
    >
      <button
        className={clsx(
          'btn btn-ghost h-8 min-h-8 w-8 p-0',
          disabled && 'btn-disabled !bg-transparent',
          className,
        )}
        onClick={disabled ? undefined : onClick}
        disabled={disabled}
      >
        {icon}
      </button>
    </div>
  );
};

export default Button;
