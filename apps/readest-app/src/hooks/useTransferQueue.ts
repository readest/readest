import { useEffect, useCallback, useMemo } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from './useTranslation';
import { useLibraryStore } from '@/store/libraryStore';
import { useTransferStore, TransferType } from '@/store/transferStore';
import { transferManager } from '@/services/transferManager';
import { Book } from '@/types/book';

export function useTransferQueue(libraryLoaded = true, delayInit = 0) {
  const { envConfig, appService } = useEnv();
  const _ = useTranslation();

  const transfers = useTransferStore((state) => state.transfers);
  const isQueuePaused = useTransferStore((state) => state.isQueuePaused);
  const setIsTransferQueueOpen = useTransferStore((state) => state.setIsTransferQueueOpen);

  useEffect(() => {
    const initManager = async () => {
      if (appService && envConfig) {
        const getLibrary = () => useLibraryStore.getState().library;
        const updateBookFn = async (book: Book) => {
          await useLibraryStore.getState().updateBook(envConfig, book);
        };
        const translationFn = _;
        await transferManager.initialize(appService, getLibrary, updateBookFn, translationFn);
      }
    };

    // Initialize transfer manager only when library is loaded
    if (libraryLoaded) {
      setTimeout(() => {
        initManager();
      }, delayInit);
    }
  }, [appService, envConfig, libraryLoaded, delayInit, _]);

  const queueUpload = useCallback((book: Book, priority?: number) => {
    return transferManager.queueUpload(book, priority);
  }, []);

  const queueDownload = useCallback((book: Book, priority?: number) => {
    return transferManager.queueDownload(book, priority);
  }, []);

  const queueBatchUploads = useCallback((books: Book[], priority?: number) => {
    return transferManager.queueBatchUploads(books, priority);
  }, []);

  const cancelTransfer = useCallback((transferId: string) => {
    transferManager.cancelTransfer(transferId);
  }, []);

  const retryTransfer = useCallback((transferId: string) => {
    transferManager.retryTransfer(transferId);
  }, []);

  const retryAllFailed = useCallback(() => {
    transferManager.retryAllFailed();
  }, []);

  const pauseQueue = useCallback(() => {
    transferManager.pauseQueue();
  }, []);

  const resumeQueue = useCallback(() => {
    transferManager.resumeQueue();
  }, []);

  const clearCompleted = useCallback(() => {
    useTransferStore.getState().clearCompleted();
  }, []);

  const clearFailed = useCallback(() => {
    useTransferStore.getState().clearFailed();
  }, []);

  const clearAll = useCallback(() => {
    useTransferStore.getState().clearAll();
  }, []);

  const getTransferProgress = useCallback((bookHash: string, type: TransferType) => {
    return useTransferStore.getState().getTransferByBookHash(bookHash, type);
  }, []);

  const stats = useMemo(() => {
    const transferList = Object.values(transfers);
    return {
      pending: transferList.filter((t) => t.status === 'pending').length,
      active: transferList.filter((t) => t.status === 'in_progress').length,
      completed: transferList.filter((t) => t.status === 'completed').length,
      failed: transferList.filter((t) => t.status === 'failed' || t.status === 'cancelled').length,
      total: transferList.length,
    };
  }, [transfers]);

  const pendingTransfers = useMemo(() => {
    return Object.values(transfers).filter((t) => t.status === 'pending');
  }, [transfers]);

  const activeTransfers = useMemo(() => {
    return Object.values(transfers).filter((t) => t.status === 'in_progress');
  }, [transfers]);

  const failedTransfers = useMemo(() => {
    return Object.values(transfers).filter(
      (t) => t.status === 'failed' || t.status === 'cancelled',
    );
  }, [transfers]);

  const completedTransfers = useMemo(() => {
    return Object.values(transfers).filter((t) => t.status === 'completed');
  }, [transfers]);

  const hasActiveTransfers = useMemo(() => {
    return pendingTransfers.length > 0 || activeTransfers.length > 0;
  }, [pendingTransfers, activeTransfers]);

  return {
    transfers: Object.values(transfers),
    isQueuePaused,
    stats,
    pendingTransfers,
    activeTransfers,
    failedTransfers,
    completedTransfers,
    hasActiveTransfers,

    setIsTransferQueueOpen,
    queueUpload,
    queueDownload,
    queueBatchUploads,
    cancelTransfer,
    retryTransfer,
    retryAllFailed,
    pauseQueue,
    resumeQueue,
    clearCompleted,
    clearFailed,
    clearAll,
    getTransferProgress,
  };
}
