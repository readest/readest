import { useEffect, useState } from 'react';
import { getBookXRay, useXRayStore } from '@/services/xray/xrayService';
import type { XRay } from '@/services/xray/snapshot';
import { useBookProgressValue } from '@/store/readerProgressStore';

/** A book's X-Ray up to the current page: undefined while loading, null before it is read. */
export const useBookXRay = (bookKey: string): XRay | null | undefined => {
  const location = useBookProgressValue(bookKey, (progress) => progress.location);
  const revision = useXRayStore((s) => s.revision);
  const [xray, setXRay] = useState<XRay | null>();

  useEffect(() => {
    let stale = false;
    void getBookXRay(bookKey)
      .catch((err) => {
        console.warn('Failed to load the X-Ray', err);
        return null;
      })
      .then((data) => {
        if (!stale) setXRay(data);
      });
    return () => {
      stale = true;
    };
  }, [bookKey, location, revision]);

  return xray;
};
