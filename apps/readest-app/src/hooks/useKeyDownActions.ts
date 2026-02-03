import { RefObject, useEffect, useRef } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useDeviceControlStore } from '@/store/deviceStore';
import { eventDispatcher } from '@/utils/event';

interface UseKeyDownOptions {
  onCancel?: () => void;
  onConfirm?: () => void;
  enabled?: boolean;
  elementRef?: RefObject<HTMLElement | null>;
}

export const useKeyDownActions = ({
  onCancel,
  onConfirm,
  enabled = true,
  elementRef: providedRef,
}: UseKeyDownOptions) => {
  const { appService } = useEnv();
  const { acquireBackKeyInterception, releaseBackKeyInterception } = useDeviceControlStore();
  const internalRef = useRef<HTMLDivElement | null>(null);
  const elementRef = providedRef || internalRef;

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent | CustomEvent) => {
      if (event instanceof CustomEvent) {
        if (event.detail.keyName === 'Back') {
          onCancel?.();
          return true;
        }
      } else {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onCancel?.();
        } else if (event.key === 'Enter') {
          event.stopPropagation();
          onConfirm?.();
        }
      }
      return false;
    };

    window.addEventListener('keydown', handleKeyDown);

    if (elementRef.current) {
      elementRef.current.addEventListener('keydown', handleKeyDown);
    }

    if (appService?.isAndroidApp) {
      acquireBackKeyInterception?.();
      eventDispatcher.onSync('native-key-down', handleKeyDown);
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown);

      if (appService?.isAndroidApp) {
        releaseBackKeyInterception?.();
        eventDispatcher.offSync('native-key-down', handleKeyDown);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, appService?.isAndroidApp]);

  return internalRef;
};
