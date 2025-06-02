'use client';

import { useEffect, useState } from 'react';
import { IconContext } from 'react-icons';
import { AuthProvider } from '@/context/AuthContext';
import { EnvProvider } from '@/context/EnvContext';
import { CSPostHogProvider } from '@/context/PHContext';
import { SyncProvider } from '@/context/SyncContext';
import { useDefaultIconSize } from '@/hooks/useResponsiveSize';
import { isWebAppPlatform } from '@/services/environment';

const Providers = ({ children }: { children: React.ReactNode }) => {
  const iconSize = useDefaultIconSize();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted || isWebAppPlatform() ? (
    <CSPostHogProvider>
      <EnvProvider>
        <AuthProvider>
          <IconContext.Provider value={{ size: `${iconSize}px` }}>
            <SyncProvider>{children}</SyncProvider>
          </IconContext.Provider>
        </AuthProvider>
      </EnvProvider>
    </CSPostHogProvider>
  ) : null;
};

export default Providers;
