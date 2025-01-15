'use client';

import * as React from 'react';
import { useEffect, Suspense, useRef } from 'react';

import { useEnv } from '@/context/EnvContext';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { AboutWindow } from '@/components/AboutWindow';
import { Toast } from '@/components/Toast';
import ReaderContent from './ReaderContent';

const Reader: React.FC<{ ids?: string }> = ({ ids }) => {
  const { envConfig } = useEnv();
  const { settings, setSettings } = useSettingsStore();
  const { library, setLibrary } = useLibraryStore();
  const isInitiating = useRef(false);

  useEffect(() => {
    if (isInitiating.current) return;
    isInitiating.current = true;
    const initLibrary = async () => {
      const appService = await envConfig.getAppService();
      const settings = await appService.loadSettings();
      setSettings(settings);
      setLibrary(await appService.loadLibraryBooks());
    };

    initLibrary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    library.length > 0 &&
    settings.globalReadSettings && (
      <div className='reader-page rounded-window bg-base-100 text-base-content h-dvh select-none'>
        <Suspense>
          <ReaderContent ids={ids} settings={settings} />
          <AboutWindow />
          <Toast />
        </Suspense>
      </div>
    )
  );
};

export default Reader;
