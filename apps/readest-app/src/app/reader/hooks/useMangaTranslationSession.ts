import { useCallback, useEffect, useRef } from 'react';

import {
  MangaTranslationEngine,
  type TranslatedMangaPage,
} from '@/app/reader/services/manga/mangaTranslationEngine';
import { MangaTranslationSession } from '@/app/reader/services/manga/mangaTranslationSession';

interface MangaTranslationProgress {
  status: string;
  progress: number;
}

interface UseMangaTranslationSessionOptions {
  enabled: boolean;
  getDocuments?: () => readonly { doc?: Document; index?: number }[];
  onProgress?: (progress: MangaTranslationProgress) => void;
  onError?: (error: unknown, pageIndex: number) => void;
  onPageTranslated?: (page: TranslatedMangaPage) => void;
}

export const useMangaTranslationSession = ({
  enabled,
  getDocuments,
  onProgress,
  onError,
  onPageTranslated,
}: UseMangaTranslationSessionOptions): ((
  doc: Document,
  pageIndex: number,
) => Promise<TranslatedMangaPage | null>) => {
  const sessionRef = useRef<MangaTranslationSession | null>(null);
  const enabledRef = useRef(enabled);
  const getDocumentsRef = useRef(getDocuments);
  const onProgressRef = useRef(onProgress);
  const onErrorRef = useRef(onError);
  const onPageTranslatedRef = useRef(onPageTranslated);
  const documentsRef = useRef(new Map<number, Document>());
  enabledRef.current = enabled;
  getDocumentsRef.current = getDocuments;
  onProgressRef.current = onProgress;
  onErrorRef.current = onError;
  onPageTranslatedRef.current = onPageTranslated;

  const rememberDocument = useCallback((doc: Document, pageIndex: number) => {
    if (documentsRef.current.get(pageIndex) === doc) return;
    documentsRef.current.set(pageIndex, doc);
    doc.defaultView?.addEventListener(
      'pagehide',
      () => {
        if (documentsRef.current.get(pageIndex) === doc) documentsRef.current.delete(pageIndex);
      },
      { once: true },
    );
  }, []);

  const processKnownDocuments = useCallback(
    (session: MangaTranslationSession) => {
      const currentPageIndexes = new Set<number>();
      for (const { doc, index } of getDocumentsRef.current?.() ?? []) {
        if (!doc || typeof index !== 'number') continue;
        rememberDocument(doc, index);
        currentPageIndexes.add(index);
        void session.processDocument(doc, index);
      }
      for (const [pageIndex, doc] of documentsRef.current) {
        if (currentPageIndexes.has(pageIndex)) continue;
        void session.processDocument(doc, pageIndex);
      }
    },
    [rememberDocument],
  );

  useEffect(() => {
    let session!: MangaTranslationSession;
    session = new MangaTranslationSession({
      createEngine: () =>
        new MangaTranslationEngine({
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
      onPageTranslated: (page) => {
        if (sessionRef.current === session && enabledRef.current) {
          onPageTranslatedRef.current?.(page);
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
  }, [processKnownDocuments]);

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
      return sessionRef.current?.processDocument(doc, pageIndex) ?? Promise.resolve(null);
    },
    [rememberDocument],
  );
};
