import { useEffect, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { checkEinkRefreshSupported } from '@/utils/bridge';

/**
 * Whether this Android device exposes a deep e-ink full-refresh mechanism we
 * can drive. Shared by the 'Auto Full Refresh' row and the 'Refresh Page'
 * slot so the two surfaces can never drift apart; the underlying probe is
 * memoized, so mounting both still queries the native side only once.
 */
export function useEinkRefreshSupported(): boolean {
  const { appService } = useEnv();
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    if (!appService?.isAndroidApp) return;
    let active = true;
    checkEinkRefreshSupported().then((result) => {
      if (active) setSupported(result);
    });
    return () => {
      active = false;
    };
  }, [appService]);

  return supported;
}
