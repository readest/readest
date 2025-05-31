import React, { useEffect, useState } from 'react';
import { RiTranslateAi } from 'react-icons/ri';

import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import { saveViewSettings } from '../utils/viewSettingsHelper';
import { isSameLang } from '@/utils/lang';
import Button from '@/components/Button';
import { getLocale } from '@/utils/misc';

const TranslationToggler = ({ bookKey }: { bookKey: string }) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { getBookData } = useBookDataStore();
  const { getViewSettings, setViewSettings, setHoveredBookKey } = useReaderStore();

  const bookData = getBookData(bookKey);
  const viewSettings = getViewSettings(bookKey)!;
  const [translationEnabled, setTranslationEnabled] = useState(viewSettings.translationEnabled!);

  const primaryLanguage = bookData?.book?.primaryLanguage;
  const targetLanguage = viewSettings.translateTargetLang;

  useEffect(() => {
    if (translationEnabled === viewSettings.translationEnabled) return;
    if (appService?.isMobile) {
      setHoveredBookKey('');
    }
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
        !bookData ||
        bookData.book?.format === 'PDF' ||
        isSameLang(primaryLanguage, targetLanguage) ||
        (!targetLanguage && isSameLang(primaryLanguage, getLocale()))
      }
      onClick={() => setTranslationEnabled(!translationEnabled)}
      tooltip={translationEnabled ? _('Disable Translation') : _('Enable Translation')}
      tooltipDirection='bottom'
    ></Button>
  );
};

export default TranslationToggler;
