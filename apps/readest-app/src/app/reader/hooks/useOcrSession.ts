import { useCallback, useEffect, useMemo, useRef } from 'react';

import { OcrSession } from '@/app/reader/services/ocr/ocrSession';
import type { OcrPage } from '@/app/reader/services/ocr/types';
import {
  TesseractOcrEngine,
  type OcrEngineProgress,
} from '@/app/reader/services/ocr/tesseractEngine';
import {
  getOcrTextLanguage,
  getTesseractLanguages,
} from '@/app/reader/services/ocr/tesseractLanguages';

interface UseOcrSessionOptions {
  enabled: boolean;
  language?: string | readonly string[];
  mangaFallback?: boolean;
  mangaMode?: boolean;
  getDocuments?: () => readonly { doc?: Document; index?: number }[];
  onProgress?: (progress: OcrEngineProgress) => void;
  onError?: (error: unknown, pageIndex: number) => void;
  onPageRecognized?: (page: OcrPage) => void;
}

export const useOcrSession = ({
  enabled,
  language,
  mangaFallback = false,
  mangaMode = false,
  getDocuments,
  onProgress,
  onError,
  onPageRecognized,
}: UseOcrSessionOptions): ((doc: Document, pageIndex: number) => Promise<OcrPage | null>) => {
  const sessionRef = useRef<OcrSession | null>(null);
  const enabledRef = useRef(enabled);
  const onProgressRef = useRef(onProgress);
  const onErrorRef = useRef(onError);
  const onPageRecognizedRef = useRef(onPageRecognized);
  const documentsRef = useRef(new Map<number, Document>());
  const getDocumentsRef = useRef(getDocuments);
  enabledRef.current = enabled;
  getDocumentsRef.current = getDocuments;
  onProgressRef.current = onProgress;
  onErrorRef.current = onError;
  onPageRecognizedRef.current = onPageRecognized;

  const rememberDocument = useCallback((doc: Document, pageIndex: number) => {
    if (documentsRef.current.get(pageIndex) === doc) return;
    documentsRef.current.set(pageIndex, doc);
    doc.defaultView?.addEventListener(
      'pagehide',
      () => {
        if (documentsRef.current.get(pageIndex) === doc) {
          documentsRef.current.delete(pageIndex);
        }
      },
      { once: true },
    );
  }, []);

  const processKnownDocuments = useCallback(
    (session: OcrSession) => {
      const currentPageIndexes = new Set<number>();
      let current = true;
      for (const { doc, index } of getDocumentsRef.current?.() ?? []) {
        if (!doc || typeof index !== 'number') continue;
        rememberDocument(doc, index);
        currentPageIndexes.add(index);
        if (current) {
          void session.processDocument(doc, index, { priority: true });
          current = false;
        } else {
          void session.processDocument(doc, index);
        }
      }
      for (const [pageIndex, doc] of documentsRef.current) {
        if (currentPageIndexes.has(pageIndex)) continue;
        void session.processDocument(doc, pageIndex);
      }
    },
    [rememberDocument],
  );

  const languages = useMemo(
    () => getTesseractLanguages(language, { mangaFallback }),
    [language, mangaFallback],
  );
  const textLanguage = useMemo(
    () => getOcrTextLanguage(language, { mangaFallback }),
    [language, mangaFallback],
  );

  useEffect(() => {
    let session!: OcrSession;
    session = new OcrSession({
      createEngine: () =>
        new TesseractOcrEngine({
          languages,
          mangaMode,
          textLanguage,
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
    processKnownDocuments(session);
    void session.setEnabled(enabledRef.current);

    return () => {
      if (sessionRef.current === session) sessionRef.current = null;
      void session.terminate();
    };
  }, [languages, mangaMode, processKnownDocuments, textLanguage]);

  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;
    if (enabled) processKnownDocuments(session);
    void session.setEnabled(enabled);
  }, [enabled, processKnownDocuments]);

  useEffect(
    () => () => {
      documentsRef.current.clear();
    },
    [],
  );

  return useCallback(
    (doc: Document, pageIndex: number) => {
      rememberDocument(doc, pageIndex);
      const priority = getDocumentsRef.current?.()[0]?.index === pageIndex;
      return (
        sessionRef.current?.processDocument(doc, pageIndex, { priority }) ?? Promise.resolve(null)
      );
    },
    [rememberDocument],
  );
};
