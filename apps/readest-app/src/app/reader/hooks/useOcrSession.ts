import { useCallback, useEffect, useMemo, useRef } from 'react';

import { OcrSession } from '@/app/reader/services/ocr/ocrSession';
import type { OcrPage } from '@/app/reader/services/ocr/types';
import {
  TesseractOcrEngine,
  type OcrEngineProgress,
} from '@/app/reader/services/ocr/tesseractEngine';
import { getTesseractLanguages } from '@/app/reader/services/ocr/tesseractLanguages';

interface UseOcrSessionOptions {
  enabled: boolean;
  language?: string | readonly string[];
  mangaFallback?: boolean;
  onProgress?: (progress: OcrEngineProgress) => void;
  onError?: (error: unknown, pageIndex: number) => void;
  onPageRecognized?: (page: OcrPage) => void;
}

export const useOcrSession = ({
  enabled,
  language,
  mangaFallback = false,
  onProgress,
  onError,
  onPageRecognized,
}: UseOcrSessionOptions): ((doc: Document, pageIndex: number) => Promise<OcrPage | null>) => {
  const sessionRef = useRef<OcrSession | null>(null);
  const enabledRef = useRef(enabled);
  const onProgressRef = useRef(onProgress);
  const onErrorRef = useRef(onError);
  const onPageRecognizedRef = useRef(onPageRecognized);
  enabledRef.current = enabled;
  onProgressRef.current = onProgress;
  onErrorRef.current = onError;
  onPageRecognizedRef.current = onPageRecognized;

  const languages = useMemo(
    () => getTesseractLanguages(language, { mangaFallback }),
    [language, mangaFallback],
  );

  useEffect(() => {
    let session!: OcrSession;
    session = new OcrSession({
      createEngine: () =>
        new TesseractOcrEngine({
          languages,
          onProgress: (progress) => {
            if (sessionRef.current === session && enabledRef.current) {
              onProgressRef.current?.(progress);
            }
          },
        }),
      onError: (error, pageIndex) => {
        if (sessionRef.current === session && enabledRef.current) {
          onErrorRef.current?.(error, pageIndex);
        }
      },
      onPageRecognized: (page) => {
        if (sessionRef.current === session && enabledRef.current) {
          onPageRecognizedRef.current?.(page);
        }
      },
    });
    sessionRef.current = session;
    void session.setEnabled(enabledRef.current);

    return () => {
      if (sessionRef.current === session) sessionRef.current = null;
      void session.terminate();
    };
  }, [languages]);

  useEffect(() => {
    void sessionRef.current?.setEnabled(enabled);
  }, [enabled]);

  return useCallback(
    (doc: Document, pageIndex: number) =>
      sessionRef.current?.processDocument(doc, pageIndex) ?? Promise.resolve(null),
    [],
  );
};
