import clsx from 'clsx';
import React, { useState, isValidElement, ReactElement, ReactNode, useRef, useId } from 'react';
import { useDropdownContext } from '@/context/DropdownContext';
import { Overlay } from './Overlay';
import MenuItem from './MenuItem';

interface DropdownProps {
  label: string;
  className?: string;
  menuClassName?: string;
  buttonClassName?: string;
  containerClassName?: string;
  toggleButton: React.ReactNode;
  children: ReactElement<{
    setIsDropdownOpen: (isOpen: boolean) => void;
    menuClassName?: string;
    children: ReactNode;
  }>;
  disabled?: boolean;
  onToggle?: (isOpen: boolean) => void;
  showTooltip?: boolean;
}

type MenuItemProps = {
  setIsDropdownOpen?: (open: boolean) => void;
};

const enhanceMenuItems = (
  children: ReactNode,
  setIsDropdownOpen: (isOpen: boolean) => void,
): ReactNode => {
  const processNode = (node: ReactNode): ReactNode => {
    if (!isValidElement(node)) {
      return node;
    }

    const element = node as React.ReactElement<React.PropsWithChildren<MenuItemProps>>;
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
  containerClassName,
  toggleButton,
  children,
  disabled,
  onToggle,
  showTooltip = true,
}) => {
  const dropdownId = useId();
  const context = useDropdownContext();
  const isOpen = context ? context.openDropdownId === dropdownId : false;
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFocused, setIsFocused] = useState(false);

  const setIsDropdownOpen = (open: boolean) => {
    if (disabled) return;
    if (context) {
      if (open) {
        context.openDropdown(dropdownId);
      } else {
        context.closeDropdown(dropdownId);
      }
    }
    onToggle?.(open);
  };

  const toggleDropdown = () => {
    setIsFocused(!isOpen);
    setIsDropdownOpen(!isOpen);
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
    <div ref={containerRef} className={clsx('dropdown-container flex', containerClassName)}>
      {isOpen && <Overlay onDismiss={() => setIsDropdownOpen(false)} />}
      <div className={clsx('relative', isOpen && 'z-50')}>
        <button
          tabIndex={0}
          aria-haspopup='menu'
          aria-expanded={isOpen}
          aria-label={label}
          title={showTooltip ? label : undefined}
          className={clsx(
            'dropdown-toggle touch-target',
            isFocused && isOpen && 'bg-base-300/50',
            buttonClassName,
          )}
          onClick={toggleDropdown}
          onKeyDown={handleKeyDown}
        >
          {toggleButton}
        </button>
        <details
          open={isOpen}
          role='none'
          className={clsx('dropdown flex items-center justify-center', className)}
        >
          <summary aria-hidden='true' className='list-none' />
          {isOpen && childrenWithToggle}
        </details>
      </div>
    </div>
  );
};

export default Dropdown;
