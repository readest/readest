import { useEffect, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { checkEinkRefreshSupported, getCachedEinkRefreshSupported } from '@/utils/bridge';

// A rejection means the probe was inconclusive (e.g. the bridge not ready at
// first mount), not that the device lacks a hook — so we retry, a bounded
// number of times so a permanently failing command can't spin. The first probe
// runs unconditionally, so up to MAX_PROBE_RETRIES retries give N+1 total calls.
const MAX_PROBE_RETRIES = 3;
const PROBE_RETRY_DELAY_MS = 400;

/**
 * Whether this Android device exposes a deep e-ink full-refresh mechanism we
 * can drive. Shared by the 'Auto Full Refresh' row and the 'Refresh Page' slot
 * so the two surfaces can never drift apart; the underlying probe is memoized,
 * so mounting both still queries the native side only once.
 */
export function useEinkRefreshSupported(): boolean {
  const { appService } = useEnv();
  // Seed from a probe another surface already settled, so re-opening settings
  // doesn't flicker the row from hidden to visible on a later tick.
  const [supported, setSupported] = useState(getCachedEinkRefreshSupported() ?? false);

  useEffect(() => {
    if (!appService?.isAndroidApp) return;
    const settled = getCachedEinkRefreshSupported();
    if (settled !== null) {
      setSupported(settled);
      return;
    }
    let active = true;
    let retries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const probe = () => {
      checkEinkRefreshSupported().then(() => {
        if (!active) return;
        // The promise resolves false for both a confirmed negative and an
        // inconclusive rejection; only the settled cache tells them apart. A
        // settled answer (true/false) is final; a still-null cache means we were
        // rejected, so retry on a bounded schedule before giving up (hidden).
        const now = getCachedEinkRefreshSupported();
        if (now !== null) {
          setSupported(now);
        } else if (retries < MAX_PROBE_RETRIES) {
          retries++;
          timer = setTimeout(probe, PROBE_RETRY_DELAY_MS);
        } else {
          setSupported(false);
        }
      });
    };
    probe();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [appService]);

  return supported;
}
