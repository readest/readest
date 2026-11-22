import clsx from 'clsx';
import React, { useRef } from 'react';
import { useKeyDownActions } from '@/hooks/useKeyDownActions';
import { useThemeStore } from '@/store/themeStore';

interface MenuProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  onCancel?: () => void;
}

const Menu: React.FC<MenuProps> = ({ children, className, style, onCancel }) => {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const { safeAreaInsets } = useThemeStore();
  const topInset = safeAreaInsets?.top ?? 0;
  const bottomInset = safeAreaInsets?.bottom ?? 0;

  useKeyDownActions({ onCancel, elementRef: menuRef });

  return (
    <div
      ref={menuRef}
      role='none'
      className={clsx(
        'menu-container max-h-[calc(100vh-max(var(--safe-area-inset-top,0px),var(--menu-safe-area-top,0px))-max(var(--safe-area-inset-bottom,0px),var(--menu-safe-area-bottom,0px))-96px)] overflow-y-auto border-0',
        className,
      )}
      style={
        {
          '--menu-safe-area-top': `${topInset}px`,
          '--menu-safe-area-bottom': `${bottomInset}px`,
          ...style,
        } as React.CSSProperties
      }
    >
      {children}
    </div>
  );
};

export default Menu;
