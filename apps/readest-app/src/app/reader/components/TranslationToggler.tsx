import React, { useEffect, useState } from 'react';
import { RiTranslateAi } from 'react-icons/ri';

import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import { saveViewSettings } from '../utils/viewSettingsHelper';
import { isSameLang } from '@/utils/lang';
import Button from '@/components/Button';

const TranslationToggler = ({ bookKey }: { bookKey: string }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { getBookData } = useBookDataStore();
  const { getViewSettings, setViewSettings, setHoveredBookKey } = useReaderStore();

  const bookData = getBookData(bookKey);
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
      disabled={
        !bookData || isSameLang(bookData.book?.primaryLanguage, viewSettings.translateTargetLang!)
      }
      onClick={() => setTranslationEnabled(!translationEnabled)}
      tooltip={translationEnabled ? _('Disable Translation') : _('Enable Translation')}
      tooltipDirection='bottom'
    ></Button>
  );
};

export default TranslationToggler;
