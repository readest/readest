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
  const insets = useThemeStore((state) => state.safeAreaInsets);

  useKeyDownActions({ onCancel, elementRef: menuRef });

  return (
    <div
      ref={menuRef}
      role='none'
      className={clsx(
        'menu-container max-h-[calc(100vh-var(--menu-inset-y)-96px)] overflow-y-auto border-0',
        className,
      )}
      style={
        {
          '--menu-inset-y': `${(insets?.top ?? 0) + (insets?.bottom ?? 0)}px`,
          ...style,
        } as React.CSSProperties
      }
    >
      {children}
    </div>
  );
};

export default Menu;
