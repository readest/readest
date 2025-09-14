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
  onToggle,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [isPointerDown, setIsPointerDown] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const toggleDropdown = () => {
    console.error('Toggling dropdown, current state:', isOpen);
    const newIsOpen = !isOpen;
    setIsDropdownOpen(newIsOpen);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      if (!isOpen) setIsDropdownOpen(true);
      e.stopPropagation();
    } else if (e.key === 'Escape' && isOpen) {
      setIsDropdownOpen(false);
      e.stopPropagation();
    }
  };

  const handleFocus = () => {
    if (!isOpen && !isPointerDown) {
      setIsDropdownOpen(true);
    }
    setIsFocused(true);
  };

  const handleBlur = (e: React.FocusEvent) => {
    if (!containerRef.current) return;

    const relatedTarget = e.relatedTarget;
    if (relatedTarget && !containerRef.current.contains(relatedTarget)) {
      console.log('Dropdown lost focus, closing menu');
      setIsFocused(false);
      setIsDropdownOpen(false);
    }
  };

  const setIsDropdownOpen = (isOpen: boolean) => {
    setIsOpen(isOpen);
    onToggle?.(isOpen);
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
        tabIndex={0}
        aria-label={label}
        title={label}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onPointerDown={() => setIsPointerDown(true)}
        onPointerUp={() => setIsPointerDown(false)}
        className={clsx('dropdown flex flex-col', className)}
      >
        <div
          role='none'
          className={clsx('dropdown-toggle', buttonClassName, isFocused && 'bg-base-300/50')}
          onClick={toggleDropdown}
        >
          {toggleButton}
        </div>
        <div role='none' className={clsx('flex items-center justify-center', !isOpen && 'hidden')}>
          {isOpen && childrenWithToggle}
        </div>
      </div>
    </div>
  );
};

export default Dropdown;
