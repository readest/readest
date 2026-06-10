'use client';

import clsx from 'clsx';
import { useRouter, usePathname } from 'next/navigation';
import { PiBooks, PiChartBar, PiUserCircle } from 'react-icons/pi';

import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useThemeStore } from '@/store/themeStore';

const BottomNav: React.FC = () => {
  const router = useRouter();
  const pathname = usePathname();
  const _ = useTranslation();
  const iconSize = useResponsiveSize(22);
  const { safeAreaInsets: insets } = useThemeStore();

  const tabs = [
    { path: '/library', icon: PiBooks, label: _('Library') },
    { path: '/statistics', icon: PiChartBar, label: _('Statistics') },
    { path: '/user', icon: PiUserCircle, label: _('Profile') },
  ];

  const isActive = (tabPath: string) => {
    if (tabPath === '/library') {
      return pathname === '/library' || pathname === '/';
    }
    return pathname?.startsWith(tabPath);
  };

  return (
    <nav
      className='btm-nav btm-nav-sm bg-base-200 border-base-300 z-50 border-t'
      style={{
        paddingBottom: insets?.bottom ? `${insets.bottom}px` : '0px',
        height: `calc(56px + ${insets?.bottom || 0}px)`,
      }}
    >
      {tabs.map((tab) => (
        <button
          key={tab.path}
          className={clsx(
            'text-base-content/60 transition-colors',
            isActive(tab.path) && 'active text-primary',
          )}
          onClick={() => router.push(tab.path)}
          aria-label={tab.label}
        >
          <tab.icon size={iconSize} />
          <span className='btm-nav-label text-xs'>{tab.label}</span>
        </button>
      ))}
    </nav>
  );
};

export default BottomNav;
