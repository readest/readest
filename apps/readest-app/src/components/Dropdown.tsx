import clsx from 'clsx';
import React, { useState, isValidElement, ReactElement, ReactNode } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { Overlay } from './Overlay';
import MenuItem from './MenuItem';

interface DropdownProps {
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
  className,
  menuClassName,
  buttonClassName,
  toggleButton,
  children,
  onToggle,
}) => {
  const _ = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  const toggleDropdown = () => {
    const newIsOpen = !isOpen;
    setIsDropdownOpen(newIsOpen);
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
        tabIndex={0}
        role='button'
        aria-label={_('Menu')}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            if (!isOpen) toggleDropdown();
          } else if (e.key === 'Escape' && isOpen) {
            toggleDropdown();
          } else {
            e.stopPropagation();
          }
        }}
        className={clsx('dropdown', className)}
      >
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
        <div
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
