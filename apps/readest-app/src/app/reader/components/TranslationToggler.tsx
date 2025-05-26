import React, { useEffect, useState } from 'react';
import { RiTranslateAi } from 'react-icons/ri';

import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { saveViewSettings } from '../utils/viewSettingsHelper';
import Button from '@/components/Button';
import { useEnv } from '@/context/EnvContext';

const TranslationToggler = ({ bookKey }: { bookKey: string }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { getViewSettings, setViewSettings, setHoveredBookKey } = useReaderStore();
  const viewSettings = getViewSettings(bookKey)!;
  const [translationEnabled, setTranslationEnabled] = useState(viewSettings.translationEnabled!);

  useEffect(() => {
    if (translationEnabled === viewSettings.translationEnabled) return;
    setHoveredBookKey('');
    saveViewSettings(envConfig, bookKey, 'translationEnabled', translationEnabled, true, false);
    viewSettings.translationEnabled = translationEnabled;
    setViewSettings(bookKey, { ...viewSettings });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [translationEnabled]);

  return (
    <Button
      icon={
        <RiTranslateAi className={translationEnabled ? 'text-blue-500' : 'text-base-content'} />
      }
      onClick={() => setTranslationEnabled(!translationEnabled)}
      tooltip={translationEnabled ? _('Disable Translation') : _('Enable Translation')}
      tooltipDirection='bottom'
    ></Button>
  );
};

export default TranslationToggler;
