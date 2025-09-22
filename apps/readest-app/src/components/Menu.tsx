import clsx from 'clsx';
import React, { useEffect, useRef } from 'react';

interface MenuProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

const Menu: React.FC<MenuProps> = ({ children, className, style }) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTimeout(() => {
      if (menuRef.current) {
        const firstItem = menuRef.current.querySelector('[role="menuitem"]');
        if (firstItem) {
          (firstItem as HTMLElement).focus();
        }
      }
    }, 200);
  }, []);

  return (
    <div
      ref={menuRef}
      role='none'
      className={clsx('max-h-[calc(100vh-96px)] overflow-y-auto', className)}
      style={style}
    >
      {children}
    </div>
  );
};

export default Menu;
