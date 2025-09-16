import React from 'react';
import { RiFontSize } from 'react-icons/ri';

import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import Button from '@/components/Button';

const SettingsToggler = () => {
  const _ = useTranslation();
  const { setHoveredBookKey } = useReaderStore();
  const { isFontLayoutSettingsDialogOpen, setFontLayoutSettingsDialogOpen } = useSettingsStore();
  const handleToggleSettings = () => {
    setHoveredBookKey('');
    setFontLayoutSettingsDialogOpen(!isFontLayoutSettingsDialogOpen);
  };
  return (
    <Button
      icon={<RiFontSize className='text-base-content' />}
      onClick={handleToggleSettings}
      label={_('Font & Layout')}
    ></Button>
  );
};

export default SettingsToggler;
