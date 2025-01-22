import React from 'react';
import { RiFontSize } from 'react-icons/ri';

import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import Button from '@/components/Button';

const SettingsToggler = () => {
  const _ = useTranslation();
  const { isFontLayoutSettingsDialogOpen, setFontLayoutSettingsDialogOpen } = useSettingsStore();
  const handleToggleSettings = () => {
    setFontLayoutSettingsDialogOpen(!isFontLayoutSettingsDialogOpen);
  };
  return (
    <Button
      icon={<RiFontSize className='text-base-content' />}
      onClick={handleToggleSettings}
      tooltip={_('Font & Layout')}
      tooltipDirection='bottom'
    ></Button>
  );
};

export default SettingsToggler;
