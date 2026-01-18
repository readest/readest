import clsx from 'clsx';
import React, { useState, isValidElement, ReactElement, ReactNode, useRef } from 'react';
import { Overlay } from './Overlay';
import MenuItem from './MenuItem';

interface DropdownProps {
  label: string;
  className?: string;
  menuClassName?: string;
  buttonClassName?: string;
  toggleButton: React.ReactNode;
  children: ReactElement<{
    setIsDropdownOpen: (isOpen: boolean) => void;
    menuClassName?: string;
    children: ReactNode;
  }>;
  disabled?: boolean;
  onToggle?: (isOpen: boolean) => void;
}

const enhanceMenuItems = (
  children: ReactNode,
  setIsDropdownOpen: (isOpen: boolean) => void,
): ReactNode => {
  const processNode = (node: ReactNode): ReactNode => {
    if (!isValidElement(node)) {
      return node;
    }

    const element = node as ReactElement;
    const isMenuItem =
      element.type === MenuItem ||
      (typeof element.type === 'function' && element.type.name === 'MenuItem');

    const clonedElement = isMenuItem
      ? React.cloneElement(element, {
          setIsDropdownOpen,
          ...element.props,
        })
      : element;

    if (clonedElement.props?.children) {
      return React.cloneElement(clonedElement, {
        ...clonedElement.props,
        children: React.Children.map(clonedElement.props.children, processNode),
      });
    }

    return clonedElement;
  };

  return React.Children.map(children, processNode);
};

const Dropdown: React.FC<DropdownProps> = ({
  label,
  className,
  menuClassName,
  buttonClassName,
  toggleButton,
  children,
  disabled,
  onToggle,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const lastInteractionWasTapOrClick = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const setIsDropdownOpen = (open: boolean) => {
    if (disabled) return;
    setIsOpen(open);
    onToggle?.(open);
  };

  const handleTouchOrClick = () => {
    lastInteractionWasTapOrClick.current = true;
    setTimeout(() => (lastInteractionWasTapOrClick.current = false), 200);
  };

  const handleFocus = () => {
    setIsFocused(true);
    // skip touch and pointer triggered focus, this is only for keyboard and aria navigation
    if (!lastInteractionWasTapOrClick.current) {
      setIsDropdownOpen(true);
    }
  };

  const toggleDropdown = () => {
    setIsFocused(!isOpen);
    setIsDropdownOpen(!isOpen);
  };

  const handleBlur = (e: React.FocusEvent) => {
    if (process.env.NODE_ENV === 'development') {
      return;
    }
    if (!containerRef.current) return;
    if (!containerRef.current.contains(e.relatedTarget as Node)) {
      setIsFocused(false);
      setIsDropdownOpen(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      if (!isOpen) setIsDropdownOpen(true);
      e.stopPropagation();
    } else if (e.key === 'Escape') {
      setIsDropdownOpen(false);
      e.stopPropagation();
    }
  };

  const childrenWithToggle = isValidElement(children)
    ? React.cloneElement(children, {
        ...(typeof children.type !== 'string' && {
          setIsDropdownOpen,
          menuClassName,
        }),
        children: enhanceMenuItems(children.props?.children, setIsDropdownOpen),
      })
    : children;

  return (
    <div className='dropdown-container flex'>
      {isOpen && <Overlay onDismiss={() => setIsDropdownOpen(false)} />}
      <div
        ref={containerRef}
        role='menu'
        tabIndex={-1}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className={clsx('dropdown flex flex-col', className)}
      >
        <button
          aria-haspopup='menu'
          aria-expanded={isOpen}
          aria-label={label}
          title={label}
          className={clsx(
            'dropdown-toggle touch-target',
            isFocused && isOpen && 'bg-base-300/50',
            buttonClassName,
          )}
          onTouchStart={handleTouchOrClick}
          onPointerDown={handleTouchOrClick}
          onFocus={handleFocus}
          onClick={toggleDropdown}
        >
          {toggleButton}
        </button>
        <div role='none' className={clsx('flex items-center justify-center')}>
          {isOpen && childrenWithToggle}
        </div>
      </div>
    </div>
  );
};

export default Dropdown;
