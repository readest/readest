import React, { useEffect, useState } from 'react';
import { RiTranslateAi } from 'react-icons/ri';

import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import { saveViewSettings } from '@/helpers/settings';
import { isTranslationAvailable } from '@/services/translators/utils';
import Button from '@/components/Button';

const TranslationToggler = ({ bookKey }: { bookKey: string }) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { getBookData } = useBookDataStore();
  const { getViewSettings, setViewSettings, setHoveredBookKey } = useReaderStore();

  const bookData = getBookData(bookKey);
  const viewSettings = getViewSettings(bookKey)!;
  const [translationEnabled, setTranslationEnabled] = useState(viewSettings.translationEnabled!);
  const [translationAvailable, setTranslationAvailable] = useState(
    isTranslationAvailable(bookData?.book, viewSettings.translateTargetLang),
  );

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

  useEffect(() => {
    setTranslationEnabled(viewSettings.translationEnabled);
    setTranslationAvailable(
      isTranslationAvailable(bookData?.book, viewSettings.translateTargetLang),
    );
  }, [bookData, viewSettings.translationEnabled, viewSettings.translateTargetLang]);

  return (
    <Button
      icon={
        <RiTranslateAi className={translationEnabled ? 'text-blue-500' : 'text-base-content'} />
      }
      aria-label={_('Toggle Translation')}
      disabled={!translationAvailable && !translationEnabled}
      onClick={() => setTranslationEnabled(!translationEnabled)}
      label={
        translationAvailable
          ? translationEnabled
            ? _('Disable Translation')
            : _('Enable Translation')
          : _('Translation Disabled')
      }
    ></Button>
  );
};

export default TranslationToggler;
