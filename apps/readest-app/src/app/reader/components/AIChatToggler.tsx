import React from 'react';
import { RiRobotLine } from 'react-icons/ri';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useAIChatStore } from '@/store/aiChatStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import Button from '@/components/Button';

interface AIChatTogglerProps {
  bookKey: string;
}

const AIChatToggler: React.FC<AIChatTogglerProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { setHoveredBookKey } = useReaderStore();
  const { sideBarBookKey, setSideBarBookKey } = useSidebarStore();
  const { isAIChatVisible, toggleAIChat } = useAIChatStore();
  const iconSize16 = useResponsiveSize(16);

  const handleToggleSidebar = () => {
    if (appService?.isMobile) setHoveredBookKey('');
    if (sideBarBookKey === bookKey) {
      toggleAIChat();
    } else {
      setSideBarBookKey(bookKey);
      if (!isAIChatVisible) toggleAIChat();
    }
  };

  return (
    <Button
      icon={<RiRobotLine size={iconSize16} className='text-base-content' />}
      onClick={handleToggleSidebar}
      label={_('AI Chat')}
    />
  );
};

export default AIChatToggler;
