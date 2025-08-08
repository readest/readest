'use client';

import { useEffect } from 'react';
import { IconContext } from 'react-icons';
import { AuthProvider } from '@/context/AuthContext';
import { useEnv } from '@/context/EnvContext';
import { CSPostHogProvider } from '@/context/PHContext';
import { SyncProvider } from '@/context/SyncContext';
import { useDefaultIconSize } from '@/hooks/useResponsiveSize';
import { initSystemThemeListener } from '@/store/themeStore';

const Providers = ({ children }: { children: React.ReactNode }) => {
  const { appService } = useEnv();
  const iconSize = useDefaultIconSize();

  useEffect(() => {
    if (appService) {
      initSystemThemeListener(appService);
    }
  }, [appService]);

  return (
    <CSPostHogProvider>
      <AuthProvider>
        <IconContext.Provider value={{ size: `${iconSize}px` }}>
          <SyncProvider>{children}</SyncProvider>
        </IconContext.Provider>
      </AuthProvider>
    </CSPostHogProvider>
  );
};

export default Providers;
