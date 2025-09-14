import clsx from 'clsx';
import React, { useEffect, useRef } from 'react';

interface MenuProps {
  children: React.ReactNode;
  label: string;
  className?: string;
}

const Menu: React.FC<MenuProps> = ({ children, className }) => {
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
    <div ref={menuRef} role='none' className={clsx(className)}>
      {children}
    </div>
  );
};

export default Menu;
