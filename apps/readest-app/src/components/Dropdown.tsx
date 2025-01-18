import clsx from 'clsx';
import React, { useState, isValidElement, ReactElement } from 'react';

interface DropdownProps {
  className?: string;
  menuClassName?: string;
  buttonClassName?: string;
  toggleButton: React.ReactNode;
  children: ReactElement<{ setIsDropdownOpen: (isOpen: boolean) => void; menuClassName?: string }>;
  onToggle?: (isOpen: boolean) => void;
}

const Dropdown: React.FC<DropdownProps> = ({
  className,
  menuClassName,
  buttonClassName,
  toggleButton,
  children,
  onToggle,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const toggleDropdown = () => {
    const newIsOpen = !isOpen;
    setIsOpen(newIsOpen);
    onToggle?.(newIsOpen);
  };

  const setIsDropdownOpen = (isOpen: boolean) => {
    setIsOpen(isOpen);
    onToggle?.(isOpen);
  };

  const childrenWithToggle = isValidElement(children)
    ? React.cloneElement(children, { setIsDropdownOpen, menuClassName })
    : children;

  return (
    <div className='dropdown-container'>
      {isOpen && (
        <div className='fixed inset-0 bg-transparent' onClick={() => setIsDropdownOpen(false)} />
      )}
      <div className={clsx('dropdown', className)}>
        <div
          tabIndex={-1}
          onClick={toggleDropdown}
          className={clsx('dropdown-toggle', buttonClassName, isOpen && 'bg-base-300/50')}
        >
          {toggleButton}
        </div>
        {isOpen && childrenWithToggle}
      </div>
    </div>
  );
};

export default Dropdown;
