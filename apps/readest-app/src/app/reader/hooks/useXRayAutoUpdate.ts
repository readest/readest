import { useEffect } from 'react';
import { updateXRay } from '@/services/xray/xrayService';
import { useCustomDictionaryStore } from '@/store/customDictionaryStore';

const SETTLE_MS = 3000;

/** Reads on into the X-Ray as the reader does, once a page has been stayed on. */
export const useXRayAutoUpdate = (bookKey: string, location: string | undefined) => {
  const enabled = useCustomDictionaryStore((s) => s.settings.xrayAutoUpdate ?? false);
  useEffect(() => {
    if (!enabled || !location) return;
    const timer = setTimeout(() => void updateXRay(bookKey, { wholeBatches: true }), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [enabled, bookKey, location]);
};
