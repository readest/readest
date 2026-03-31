'use client';

import { useTranslation } from '@/hooks/useTranslation';
import { FiHome, FiBook, FiRss, FiGlobe } from 'react-icons/fi';

export type NavigationView = 'dashboard' | 'library' | 'feeds' | 'sources';

interface NavigationRailProps {
  activeView: NavigationView;
  onChangeView: (view: NavigationView) => void;
}

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}

function NavItem({ icon, label, active, onClick }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-1 p-2 rounded-lg transition-colors ${
        active
          ? 'text-white bg-primary'
          : 'text-base-content/60 hover:text-base-content hover:bg-base-300'
      }`}
      title={label}
    >
      <div className="h-5 w-5">{icon}</div>
      <span className="text-xs font-medium">{label}</span>
    </button>
  );
}

export function NavigationRail({ activeView, onChangeView }: NavigationRailProps) {
  const _ = useTranslation();

  return (
    <nav className="bg-base-200 flex h-full w-20 flex-col items-center py-4">
      <div className="flex flex-col gap-2">
        <NavItem
          icon={<FiHome />}
          label={_('Dashboard')}
          active={activeView === 'dashboard'}
          onClick={() => onChangeView('dashboard')}
        />
        <NavItem
          icon={<FiBook />}
          label={_('Library')}
          active={activeView === 'library'}
          onClick={() => onChangeView('library')}
        />
        <NavItem
          icon={<FiGlobe />}
          label={_('Sources')}
          active={activeView === 'sources'}
          onClick={() => onChangeView('sources')}
        />
        <NavItem
          icon={<FiRss />}
          label={_('Feeds')}
          active={activeView === 'feeds'}
          onClick={() => onChangeView('feeds')}
        />
      </div>
    </nav>
  );
}
