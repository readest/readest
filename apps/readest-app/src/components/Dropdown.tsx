import clsx from 'clsx';
import React, {
  useState,
  isValidElement,
  ReactElement,
  ReactNode,
  useLayoutEffect,
  useRef,
  useId,
} from 'react';
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

const MENU_VIEWPORT_PADDING = 16;

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
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [isFocused, setIsFocused] = useState(false);

  // The menu stays CSS-anchored next to its toggle (screen readers and Tab
  // traverse it in DOM order), so a menu near a screen edge can stick out of
  // the viewport (#5259). Measure the open menu and shift it back inside.
  useLayoutEffect(() => {
    if (!isOpen) return undefined;
    const content = detailsRef.current?.querySelector<HTMLElement>(':scope > :not(summary)');
    if (!content) return undefined;
    const clamp = () => {
      content.style.transform = '';
      const rect = content.getBoundingClientRect();
      let dx = 0;
      if (rect.right > window.innerWidth - MENU_VIEWPORT_PADDING) {
        dx = window.innerWidth - MENU_VIEWPORT_PADDING - rect.right;
      }
      if (rect.left + dx < MENU_VIEWPORT_PADDING) {
        dx = MENU_VIEWPORT_PADDING - rect.left;
      }
      if (dx !== 0) {
        content.style.transform = `translateX(${dx}px)`;
      }
    };
    clamp();
    window.addEventListener('resize', clamp);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(clamp) : null;
    observer?.observe(content);
    return () => {
      window.removeEventListener('resize', clamp);
      observer?.disconnect();
      content.style.transform = '';
    };
  }, [isOpen]);

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
      // Let the native button click (dispatched by the browser for Enter/Space
      // on a focused button) drive the toggle — toggling here would race with
      // that click and cancel it out. We still stop propagation so global
      // shortcuts bound to Enter/Space (e.g. next page in the reader) don't
      // fire while a dropdown button is focused.
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
          ref={detailsRef}
          open={isOpen}
          role='none'
          className={clsx('dropdown flex items-center justify-center', className)}
        >
          <summary aria-hidden='true' tabIndex={-1} className='list-none' />
          {isOpen && childrenWithToggle}
        </details>
      </div>
    </div>
  );
};

export default Dropdown;
