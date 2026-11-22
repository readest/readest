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

const handledDndEvents = new WeakSet<KeyboardEvent>();

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
  // The listener is registered once per `enabled`; read the callbacks through
  // refs so it always calls the latest render's handlers, not stale closures.
  const onCancelRef = useRef(onCancel);
  const onConfirmRef = useRef(onConfirm);
  onCancelRef.current = onCancel;
  onConfirmRef.current = onConfirm;

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent | CustomEvent) => {
      if (event instanceof CustomEvent) {
        if (event.detail.keyName === 'Back') {
          onCancelRef.current?.();
          return true;
        }
      } else {
        if (handledDndEvents.has(event)) {
          return false;
        }
        const isDndDragging = Boolean(
          elementRef.current?.querySelector('[data-dnd-dragging="true"]'),
        );
        const isDndHandle =
          event.target instanceof Element &&
          Boolean(event.target.closest('[data-dnd-sortable-handle="true"]'));
        if (
          isDndDragging &&
          (event.key === 'Escape' ||
            event.key === ' ' ||
            event.key === 'Enter' ||
            event.key === 'ArrowUp' ||
            event.key === 'ArrowDown' ||
            event.key === 'ArrowLeft' ||
            event.key === 'ArrowRight')
        ) {
          handledDndEvents.add(event);
          return false;
        }
        if (isDndHandle && (event.key === ' ' || event.key === 'Enter')) {
          handledDndEvents.add(event);
          return false;
        }
        if (event.key === 'Escape') {
          onCancelRef.current?.();
        } else if (event.key === 'Enter') {
          onConfirmRef.current?.();
        }
        event.stopPropagation();
      }
      return false;
    };

    // With focus in the book, its keys arrive as an `iframe-keydown` message.
    // Escape there still dismisses; Enter there confirms nothing.
    const handleBookKey = (msg: MessageEvent) => {
      if (msg.data?.type === 'iframe-keydown' && msg.data.key === 'Escape') onCancelRef.current?.();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('message', handleBookKey);

    const element = elementRef.current;
    element?.addEventListener('keydown', handleKeyDown);

    if (appService?.isAndroidApp) {
      acquireBackKeyInterception?.();
      eventDispatcher.onSync('native-key-down', handleKeyDown);
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('message', handleBookKey);
      element?.removeEventListener('keydown', handleKeyDown);

      if (appService?.isAndroidApp) {
        releaseBackKeyInterception?.();
        eventDispatcher.offSync('native-key-down', handleKeyDown);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, appService?.isAndroidApp]);

  return internalRef;
};
