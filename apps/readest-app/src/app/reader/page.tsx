'use client';

import { useEffect } from 'react';
import { useTheme } from '@/hooks/useTheme';
import { hasUpdater } from '@/services/environment';
import { checkForAppUpdates } from '@/helpers/updater';
import { useTranslation } from '@/hooks/useTranslation';
import Reader from './components/Reader';

export default function Page() {
  const _ = useTranslation();
  useTheme();
  useEffect(() => {
    const doAppUpdates = async () => {
      if (hasUpdater()) {
        await checkForAppUpdates(_);
      }
    };
    doAppUpdates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <Reader />;
}
