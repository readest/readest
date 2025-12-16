'use client';

import { useEffect } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useOpenWithBooks } from '@/hooks/useOpenWithBooks';
import { useSettingsStore } from '@/store/settingsStore';
import { checkForAppUpdates, checkAppReleaseNotes } from '@/helpers/updater';
import Reader from './components/Reader';

// This is only used for the Tauri app in the app router
export default function Page() {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { settings } = useSettingsStore();

  useOpenWithBooks();

  useEffect(() => {
    const doCheckAppUpdates = async () => {
      if (appService?.hasUpdater && settings.autoCheckUpdates) {
        await checkForAppUpdates(_);
      } else if (appService?.hasUpdater === false) {
        checkAppReleaseNotes();
      }
    };
    doCheckAppUpdates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appService?.hasUpdater, settings.autoCheckUpdates]);

  return <Reader />;
}
