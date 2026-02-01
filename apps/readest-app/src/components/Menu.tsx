import clsx from 'clsx';
import React, { useEffect, useRef } from 'react';
import { useKeyDownActions } from '@/hooks/useKeyDownActions';
import { RovingTabindexProvider } from 'react-roving-tabindex-2';

interface MenuProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  onCancel?: () => void;
}

const Menu: React.FC<MenuProps> = ({ children, className, style, onCancel }) => {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useKeyDownActions({ onCancel, elementRef: menuRef });

  useEffect(() => {
    setTimeout(() => {
      if (menuRef.current) {
        const firstItem = menuRef.current.querySelector(
          '[role="menuitem"], [role="menuitemcheckbox"]',
        );
        if (firstItem) {
          (firstItem as HTMLElement).focus();
        }
      }
    }, 200);
  }, []);

  return (
    <div
      ref={menuRef}
      role='menu'
      className={clsx(
        'menu-container max-h-[calc(100vh-96px)] overflow-y-auto border-0',
        className,
      )}
      style={style}
    >
      <RovingTabindexProvider
        wrapperElementRef={menuRef}
        classNameOfTargetElements='roving-tabindex'
        direction='vertical' // Optional
      >
        {children}
      </RovingTabindexProvider>
    </div>
  );
};

export default Menu;
