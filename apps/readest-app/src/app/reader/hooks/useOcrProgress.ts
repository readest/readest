import { useEffect, useId, useRef } from 'react';

import type { OcrEngineProgress } from '@/app/reader/services/ocr/tesseractEngine';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';

export const useOcrProgress = (enabled: boolean, language: string) => {
  const _ = useTranslation();
  const toastId = useId();
  const progressRef = useRef(-1);
  const doneRef = useRef(false);

  useEffect(() => {
    progressRef.current = -1;
    doneRef.current = false;
    const handleToastDismissed = (event: CustomEvent) => {
      if (event.detail?.id === toastId) doneRef.current = true;
    };
    eventDispatcher.on('toast-dismissed', handleToastDismissed);
    return () => {
      eventDispatcher.off('toast-dismissed', handleToastDismissed);
      void eventDispatcher.dispatch('toast-dismiss', { id: toastId });
    };
  }, [enabled, language, toastId]);

  return {
    dismiss: () => {
      doneRef.current = true;
      void eventDispatcher.dispatch('toast-dismiss', { id: toastId });
    },
    onProgress: ({ status, progress }: OcrEngineProgress) => {
      if (!enabled || doneRef.current) return;
      const recognizing = status === 'recognizing text';
      const percentage = recognizing ? Math.min(99, Math.floor(Math.max(0, progress) * 20) * 5) : 0;
      if (!Number.isFinite(percentage) || percentage <= progressRef.current) return;
      progressRef.current = percentage;
      eventDispatcher.dispatch('toast', {
        id: toastId,
        type: 'info',
        placement: 'top',
        ...(recognizing ? { progress: percentage } : {}),
        message: recognizing
          ? _('Recognizing text: {{progress}}%', { progress: percentage })
          : _('Preparing text recognition...'),
        timeout: 0,
      });
    },
    onPageRecognized: () => {
      if (!enabled || doneRef.current) return;
      doneRef.current = true;
      if (progressRef.current < 0) return;
      eventDispatcher.dispatch('toast', {
        id: toastId,
        type: 'info',
        placement: 'top',
        progress: 100,
        message: _('Text recognition continues in the background.'),
        timeout: 3000,
      });
    },
  };
};
