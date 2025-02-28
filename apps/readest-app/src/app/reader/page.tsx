'use client';

import { useEffect } from 'react';
import { useTheme } from '@/hooks/useTheme';
import { hasUpdater } from '@/services/environment';
import { checkForAppUpdates } from '@/helpers/updater';
import { useTranslation } from '@/hooks/useTranslation';
import { useOpenWithBooks } from '@/hooks/useOpenWithBooks';
import { useSettingsStore } from '@/store/settingsStore';
import Reader from './components/Reader';

export default function Page() {
  const _ = useTranslation();
  const { settings } = useSettingsStore();

  useTheme();
  useOpenWithBooks();

  useEffect(() => {
    const doCheckAppUpdates = async () => {
      if (hasUpdater() && settings.autoCheckUpdates) {
        await checkForAppUpdates(_);
      }
    };
    doCheckAppUpdates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  return <Reader />;
}
