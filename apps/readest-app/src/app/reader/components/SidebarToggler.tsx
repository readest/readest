import React from 'react';
import { TbLayoutSidebar, TbLayoutSidebarFilled } from 'react-icons/tb';

import { useSidebarStore } from '@/store/sidebarStore';
import { useTranslation } from '@/hooks/useTranslation';
import Button from '@/components/Button';

interface SidebarTogglerProps {
  bookKey: string;
}

const SidebarToggler: React.FC<SidebarTogglerProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const { sideBarBookKey, isSideBarVisible, setSideBarBookKey, toggleSideBar } = useSidebarStore();
  const handleToggleSidebar = () => {
    if (sideBarBookKey === bookKey) {
      toggleSideBar();
    } else {
      setSideBarBookKey(bookKey);
      if (!isSideBarVisible) toggleSideBar();
    }
  };
  return (
    <Button
      icon={
        sideBarBookKey === bookKey && isSideBarVisible ? (
          <TbLayoutSidebarFilled size={20} className='text-base-content' />
        ) : (
          <TbLayoutSidebar size={20} className='text-base-content' />
        )
      }
      onClick={handleToggleSidebar}
      tooltip={_('Sidebar')}
      tooltipDirection='bottom'
    />
  );
};

export default SidebarToggler;
