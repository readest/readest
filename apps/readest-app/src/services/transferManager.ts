import { Book } from '@/types/book';
import { AppService, BaseDir } from '@/types/system';
import { useTransferStore, TransferItem, ReplicaTransferFile } from '@/store/transferStore';
import { TranslationFunc } from '@/hooks/useTranslation';
import { ProgressHandler, ProgressPayload } from '@/utils/transfer';
import { eventDispatcher } from '@/utils/event';
import { getTransferMessages } from './transferMessages';

const TRANSFER_QUEUE_KEY = 'readest_transfer_queue';
const RETRY_DELAY_BASE_MS = 2000;

interface PersistedQueueData {
  transfers: Record<string, TransferItem>;
  isQueuePaused: boolean;
}

class TransferManager {
  private static instance: TransferManager;
  private appService: AppService | null = null;
  private isProcessing = false;
  private abortControllers: Map<string, AbortController> = new Map();
  private isInitialized = false;
  private getLibrary: (() => Book[]) | null = null;
  private updateBook: ((book: Book) => Promise<void>) | null = null;
  private _: TranslationFunc | null = null;
  private readyResolve: () => void = () => {};
  private readyPromise: Promise<void> = new Promise<void>((resolve) => {
    this.readyResolve = resolve;
  });

  private constructor() {}

  static getInstance(): TransferManager {
    if (!TransferManager.instance) {
      TransferManager.instance = new TransferManager();
    }
    return TransferManager.instance;
  }

  async initialize(
    appService: AppService,
    getLibrary: () => Book[],
    updateBook: (book: Book) => Promise<void>,
    translationFn: TranslationFunc,
  ): Promise<void> {
    if (this.isInitialized) return;

    this.appService = appService;
    this.getLibrary = getLibrary;
    this.updateBook = updateBook;
    this._ = translationFn;
    await this.loadPersistedQueue();
    this.isInitialized = true;
    this.readyResolve();

    // Start processing queue
    this.processQueue();
  }

  isReady(): boolean {
    return this.isInitialized && this.appService !== null;
  }

  /**
   * Resolves once `initialize()` has completed. Lets callers that need
   * to enqueue transfers (e.g., the boot-time replica pull) defer until
   * the manager is wired up — the manager only inits after the library
   * is loaded, which can lag well behind app boot.
   */
  waitUntilReady(): Promise<void> {
    return this.readyPromise;
  }

  queueUpload(book: Book, priority: number = 10): string | null {
    if (!this.isReady()) {
      console.warn('TransferManager not initialized');
      return null;
    }

    const store = useTransferStore.getState();

    // Check if already queued or in progress
    const existing = store.getTransferByBookHash(book.hash, 'upload');
    if (existing) {
      return existing.id;
    }

    const transferId = store.addTransfer(book.hash, book.title, 'upload', priority);
    this.persistQueue();
    this.processQueue();
    return transferId;
  }

  queueDownload(book: Book, priority: number = 10): string | null {
    if (!this.isReady()) {
      console.warn('TransferManager not initialized');
      return null;
    }

    const store = useTransferStore.getState();

    const existing = store.getTransferByBookHash(book.hash, 'download');
    if (existing) {
      return existing.id;
    }

    const transferId = store.addTransfer(book.hash, book.title, 'download', priority);
    this.persistQueue();
    this.processQueue();
    return transferId;
  }

  queueDelete(book: Book, priority: number = 10, isBackground: boolean = false): string | null {
    if (!this.isReady()) {
      console.warn('TransferManager not initialized');
      return null;
    }

    const store = useTransferStore.getState();

    const existing = store.getTransferByBookHash(book.hash, 'delete');
    if (existing) {
      return existing.id;
    }

    const transferId = store.addTransfer(book.hash, book.title, 'delete', priority, isBackground);
    this.persistQueue();
    this.processQueue();
    return transferId;
  }

  queueBatchUploads(books: Book[], priority: number = 10): string[] {
    return books
      .map((book) => this.queueUpload(book, priority))
      .filter((id): id is string => id !== null);
  }

  queueReplicaUpload(
    replicaKind: string,
    replicaId: string,
    displayTitle: string,
    files: ReplicaTransferFile[],
    base: BaseDir,
    opts: { priority?: number; isBackground?: boolean; reincarnation?: string } = {},
  ): string | null {
    if (!this.isReady()) {
      console.warn('TransferManager not initialized');
      return null;
    }
    const store = useTransferStore.getState();
    const existing = store.getReplicaTransfer(replicaKind, replicaId, 'upload');
    if (existing) return existing.id;

    const id = store.addReplicaTransfer(replicaKind, replicaId, displayTitle, 'upload', {
      priority: opts.priority,
      isBackground: opts.isBackground,
      files,
      base,
      reincarnation: opts.reincarnation,
    });
    this.persistQueue();
    this.processQueue();
    return id;
  }

  queueReplicaDownload(
    replicaKind: string,
    replicaId: string,
    displayTitle: string,
    files: ReplicaTransferFile[],
    base: BaseDir,
    opts: { priority?: number; isBackground?: boolean } = {},
  ): string | null {
    if (!this.isReady()) {
      console.warn('TransferManager not initialized');
      return null;
    }
    const store = useTransferStore.getState();
    const existing = store.getReplicaTransfer(replicaKind, replicaId, 'download');
    if (existing) return existing.id;

    const id = store.addReplicaTransfer(replicaKind, replicaId, displayTitle, 'download', {
      priority: opts.priority,
      isBackground: opts.isBackground,
      files,
      base,
    });
    this.persistQueue();
    this.processQueue();
    return id;
  }

  queueReplicaDelete(
    replicaKind: string,
    replicaId: string,
    displayTitle: string,
    filenames: string[],
    opts: { priority?: number; isBackground?: boolean } = {},
  ): string | null {
    if (!this.isReady()) {
      console.warn('TransferManager not initialized');
      return null;
    }
    const store = useTransferStore.getState();
    const existing = store.getReplicaTransfer(replicaKind, replicaId, 'delete');
    if (existing) return existing.id;

    const id = store.addReplicaTransfer(replicaKind, replicaId, displayTitle, 'delete', {
      priority: opts.priority,
      isBackground: opts.isBackground,
      files: filenames.map((logical) => ({ logical, lfp: '', byteSize: 0 })),
    });
    this.persistQueue();
    this.processQueue();
    return id;
  }

  cancelTransfer(transferId: string): void {
    const controller = this.abortControllers.get(transferId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(transferId);
    }

    useTransferStore.getState().setTransferStatus(transferId, 'cancelled');
    this.persistQueue();
  }

  retryTransfer(transferId: string): void {
    const store = useTransferStore.getState();
    store.retryTransfer(transferId);
    this.persistQueue();
    this.processQueue();
  }

  retryAllFailed(): void {
    const store = useTransferStore.getState();
    const failed = store.getFailedTransfers();
    failed.forEach((transfer) => {
      store.retryTransfer(transfer.id);
    });
    this.persistQueue();
    this.processQueue();
  }

  pauseQueue(): void {
    useTransferStore.getState().pauseQueue();
    this.persistQueue();
  }

  resumeQueue(): void {
    useTransferStore.getState().resumeQueue();
    this.processQueue();
    this.persistQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;

    this.isProcessing = true;

    try {
      await this._processQueueInternal();
    } finally {
      this.isProcessing = false;
    }
  }

  private async _processQueueInternal(): Promise<void> {
    const store = useTransferStore.getState();

    if (store.isQueuePaused) return;

    const pending = store.getPendingTransfers();
    const activeCount = store.getActiveTransfers().length;
    const maxConcurrent = store.maxConcurrent;

    const availableSlots = maxConcurrent - activeCount;
    if (availableSlots <= 0 || pending.length === 0) return;

    // Sort by priority (lower = higher priority) then by createdAt
    const sortedPending = [...pending].sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.createdAt - b.createdAt;
    });

    const toProcess = sortedPending.slice(0, availableSlots);

    await Promise.all(toProcess.map((transfer) => this.executeTransfer(transfer)));

    // Check if more items to process
    const newStore = useTransferStore.getState();
    if (newStore.getPendingTransfers().length > 0 && !newStore.isQueuePaused) {
      setTimeout(() => this.processQueue(), 100);
    }
  }

  private async executeTransfer(transfer: TransferItem): Promise<void> {
    if (!this.appService || !this.getLibrary || !this.updateBook) {
      console.error('TransferManager not properly initialized');
      return;
    }

    const _ = this._!;
    const store = useTransferStore.getState();
    const abortController = new AbortController();
    this.abortControllers.set(transfer.id, abortController);

    store.setTransferStatus(transfer.id, 'in_progress');
    store.setActiveCount(store.getActiveTransfers().length + 1);

    const progressHandler = (progress: ProgressPayload) => {
      if (abortController.signal.aborted) return;

      const percentage = progress.total > 0 ? (progress.progress / progress.total) * 100 : 0;

      useTransferStore
        .getState()
        .updateTransferProgress(
          transfer.id,
          percentage,
          progress.progress,
          progress.total,
          progress.transferSpeed,
        );
    };

    try {
      if (transfer.kind === 'replica') {
        await this.executeReplicaTransfer(transfer, progressHandler, abortController);
      } else {
        await this.executeBookTransfer(transfer, progressHandler, abortController);
      }

      useTransferStore.getState().setTransferStatus(transfer.id, 'completed');

      const messages = getTransferMessages(transfer, _);

      if (!transfer.isBackground) {
        eventDispatcher.dispatch('toast', {
          type: 'info',
          timeout: 2000,
          message: messages.success[transfer.type],
        });
      }
    } catch (error) {
      if (abortController.signal.aborted) {
        // Already cancelled, don't update status
        return;
      }

      const errorMessage = error instanceof Error ? error.message : _('Unknown error');
      const currentStore = useTransferStore.getState();
      const currentTransfer = currentStore.transfers[transfer.id];

      if (currentTransfer && currentTransfer.retryCount < currentTransfer.maxRetries) {
        // Schedule retry with exponential backoff
        const delay = RETRY_DELAY_BASE_MS * Math.pow(2, currentTransfer.retryCount);
        currentStore.incrementRetryCount(transfer.id);
        currentStore.setTransferStatus(
          transfer.id,
          'pending',
          `Retry ${currentTransfer.retryCount + 1}/${currentTransfer.maxRetries}`,
        );

        setTimeout(() => {
          this.processQueue();
        }, delay);
      } else {
        if (errorMessage.includes('Not authenticated')) {
          eventDispatcher.dispatch('toast', {
            type: 'error',
            message: _('Please log in to continue'),
          });
        } else if (errorMessage.includes('Insufficient storage quota')) {
          eventDispatcher.dispatch('toast', {
            type: 'error',
            message: _('Insufficient storage quota'),
          });
        } else {
          const errorMessages = getTransferMessages(transfer, _).failure;

          eventDispatcher.dispatch('toast', {
            type: 'error',
            message: errorMessages[transfer.type],
          });
        }

        useTransferStore.getState().setTransferStatus(transfer.id, 'failed', errorMessage);
      }
    } finally {
      this.abortControllers.delete(transfer.id);

      const currentStore = useTransferStore.getState();
      currentStore.setActiveCount(Math.max(0, currentStore.getActiveTransfers().length));
      this.persistQueue();

      // Continue processing
      setTimeout(() => this.processQueue(), 100);
    }
  }

  private async executeBookTransfer(
    transfer: TransferItem,
    progressHandler: (p: ProgressPayload) => void,
    _abortController: AbortController,
  ): Promise<void> {
    const _ = this._!;
    const library = this.getLibrary!();
    const book = library.find((b) => b.hash === transfer.bookHash);

    if (!book) {
      throw new Error(_('Book not found in library'));
    }

    if (transfer.type === 'upload') {
      await this.appService!.uploadBook(book, progressHandler);
      book.uploadedAt = Date.now();
      await this.updateBook!(book);
    } else if (transfer.type === 'download') {
      await this.appService!.downloadBook(book, false, false, progressHandler);
      book.downloadedAt = Date.now();
      await this.updateBook!(book);
    } else if (transfer.type === 'delete') {
      await this.appService!.deleteBook(book, 'cloud');
      await this.updateBook!(book);
    }
  }

  private async executeReplicaTransfer(
    transfer: TransferItem,
    progressHandler: (p: ProgressPayload) => void,
    _abortController: AbortController,
  ): Promise<void> {
    const kind = transfer.replicaKind!;
    const replicaId = transfer.replicaId!;
    const files = transfer.replicaFiles ?? [];

    if (transfer.type === 'delete') {
      await this.appService!.deleteReplicaBundle(
        kind,
        replicaId,
        files.map((f) => f.logical),
      );
      eventDispatcher.dispatch('replica-transfer-complete', {
        kind,
        replicaId,
        type: 'delete',
        filenames: files.map((f) => f.logical),
      });
      return;
    }

    if (files.length === 0) {
      throw new Error(`replica ${transfer.type} requires replicaFiles on the transfer`);
    }

    const totalBytes = files.reduce((sum, f) => sum + f.byteSize, 0) || 1;
    let bytesAlreadyDone = 0;
    const fileProgressHandler =
      (filenameSize: number): ProgressHandler =>
      (p: ProgressPayload) => {
        const fileFraction = p.total > 0 ? p.progress / p.total : 0;
        const overallTransferred = bytesAlreadyDone + filenameSize * fileFraction;
        progressHandler({
          progress: overallTransferred,
          total: totalBytes,
          transferSpeed: p.transferSpeed,
        });
      };

    if (transfer.type === 'upload') {
      const base = transfer.replicaBase!;
      for (const file of files) {
        await this.appService!.uploadReplicaFile(
          kind,
          replicaId,
          file.logical,
          file.lfp,
          base,
          fileProgressHandler(file.byteSize),
        );
        bytesAlreadyDone += file.byteSize;
      }
      eventDispatcher.dispatch('replica-transfer-complete', {
        kind,
        replicaId,
        reincarnation: transfer.replicaReincarnation,
        type: 'upload',
        files,
      });
      return;
    }

    if (transfer.type === 'download') {
      const base = transfer.replicaBase!;
      for (const file of files) {
        await this.appService!.downloadReplicaFile(
          kind,
          replicaId,
          file.logical,
          file.lfp,
          base,
          fileProgressHandler(file.byteSize),
        );
        bytesAlreadyDone += file.byteSize;
      }
      eventDispatcher.dispatch('replica-transfer-complete', {
        kind,
        replicaId,
        type: 'download',
        files,
      });
      return;
    }
  }

  private async loadPersistedQueue(): Promise<void> {
    try {
      if (typeof localStorage === 'undefined') return;

      const stored = localStorage.getItem(TRANSFER_QUEUE_KEY);
      if (!stored) return;

      const data: PersistedQueueData = JSON.parse(stored);
      const store = useTransferStore.getState();

      // Restore all transfers using the store's restore method
      // This preserves the original IDs and handles in_progress -> pending conversion
      store.restoreTransfers(data.transfers, data.isQueuePaused);
    } catch (error) {
      console.error('Failed to load transfer queue:', error);
    }
  }

  private persistQueue(): void {
    try {
      if (typeof localStorage === 'undefined') return;

      const store = useTransferStore.getState();

      // Persist all transfers including completed (for history)
      const data: PersistedQueueData = {
        transfers: store.transfers,
        isQueuePaused: store.isQueuePaused,
      };

      localStorage.setItem(TRANSFER_QUEUE_KEY, JSON.stringify(data));
    } catch (error) {
      console.error('Failed to persist transfer queue:', error);
    }
  }
}

export const transferManager = TransferManager.getInstance();
