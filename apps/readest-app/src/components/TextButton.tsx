import clsx from 'clsx';
import React from 'react';

interface TextButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  variant?: 'primary' | 'secondary' | 'danger' | 'success';
  size?: 'sm' | 'md' | 'lg';
  type?: 'button' | 'submit' | 'reset';
}

const TextButton: React.FC<TextButtonProps> = ({
  children,
  onClick,
  disabled = false,
  className,
  variant = 'primary',
  size = 'sm',
  type = 'button',
}) => {
  const variantClasses = {
    primary: 'text-blue-500 hover:text-blue-600',
    secondary: 'text-gray-500 hover:text-gray-600',
    danger: 'text-red-500 hover:text-red-600',
    success: 'text-green-500 hover:text-green-600',
  };

  const sizeClasses = {
    sm: 'font-size-sm h-[1.3em] min-h-[1.3em]',
    md: 'font-size-md h-[1.5em] min-h-[1.5em]',
    lg: 'font-size-lg h-[1.8em] min-h-[1.8em]',
  };

  return (
    <button
      type={type}
      className={clsx(
        // daisyUI's btn carries a 1px border that btn-ghost only colours in on
        // hover, which `hover:bg-transparent` doesn't touch — it read as a box
        // appearing around Cancel/Save. Keep the border for geometry, keep it
        // invisible.
        'content settings-content btn btn-ghost hover:border-transparent hover:bg-transparent',
        'flex items-end p-0',
        sizeClasses[size],
        disabled ? 'btn-disabled bg-transparent!' : '',
        className,
      )}
      onClick={onClick}
      disabled={disabled}
    >
      <div
        className={clsx('align-bottom', sizeClasses[size].split(' ')[0], variantClasses[variant])}
      >
        {children}
      </div>
    </button>
  );
};

export default TextButton;
