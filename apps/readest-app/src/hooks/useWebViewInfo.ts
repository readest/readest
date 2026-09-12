import { useEffect, useState } from 'react';
import type { AppService } from '@/types/system';
import { parseWebViewInfo, parseWebViewInfoAsync } from '@/utils/ua';

/**
 * The WebView engine/version label for display (About dialog, error page).
 * Async on first settle: on Chromium engines the UA string's build number is
 * frozen by UA Reduction (Edg/138.0.0.0) and the real build needs a Client
 * Hints round-trip, so the label starts at the UA-parsed value and upgrades.
 * The sync parse is the fallback whenever the async path fails.
 */
export const useWebViewInfo = (appService: AppService | null): string => {
  const [info, setInfo] = useState(() => parseWebViewInfo(appService));

  useEffect(() => {
    let mounted = true;
    setInfo(parseWebViewInfo(appService));
    // parseWebViewInfoAsync never rejects (it resolves to the sync label when
    // Client Hints are unavailable), so no catch path is needed here.
    parseWebViewInfoAsync(appService).then((label) => {
      if (mounted) setInfo(label);
    });
    return () => {
      mounted = false;
    };
  }, [appService]);

  return info;
};
