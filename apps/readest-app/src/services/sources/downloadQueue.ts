/**
 * Download Queue Service
 * 
 * Manages downloads from sources with progress tracking
 * and rate limiting integration.
 */

import { SourceSearchResult } from '@/types/sources';
import { rateLimiter } from './rateLimiter';
import { SourceProviderType } from '@/types/sources';

/**
 * Download status
 */
export type DownloadStatus =
  | 'pending'
  | 'downloading'
  | 'completed'
  | 'paused'
  | 'error'
  | 'cancelled';

/**
 * Download item
 */
export interface DownloadItem {
  id: string;
  result: SourceSearchResult;
  url: string;
  status: DownloadStatus;
  progress: number;  // 0-100
  totalBytes: number;
  downloadedBytes: number;
  speed: number;  // bytes per second
  eta: number;  // seconds
  error?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  destination?: string;
}

/**
 * Download queue state
 */
interface DownloadQueueState {
  downloads: Map<string, DownloadItem>;
  activeDownloadId?: string;
  isPaused: boolean;
}

/**
 * Download queue manager
 */
export class DownloadQueue {
  private static instance: DownloadQueue;
  private state: DownloadQueueState;
  private listeners: Set<() => void> = new Set();
  private currentDownloadPromise?: Promise<void>;

  private constructor() {
    this.state = {
      downloads: new Map(),
      isPaused: false,
    };
  }

  static getInstance(): DownloadQueue {
    if (!DownloadQueue.instance) {
      DownloadQueue.instance = new DownloadQueue();
    }
    return DownloadQueue.instance;
  }

  /**
   * Add download to queue
   */
  async addDownload(result: SourceSearchResult): Promise<string> {
    const downloadId = `download-${result.sourceId}-${result.id}-${Date.now()}`;
    
    // Get download URL
    let downloadUrl = result.downloadUrl;
    if (!downloadUrl) {
      // TODO: Import getDownloadUrl when circular dependency is resolved
      console.warn('Download URL not available');
      downloadUrl = '#';
    }

    const download: DownloadItem = {
      id: downloadId,
      result,
      url: downloadUrl,
      status: 'pending',
      progress: 0,
      totalBytes: 0,
      downloadedBytes: 0,
      speed: 0,
      eta: 0,
      createdAt: Date.now(),
    };

    this.state.downloads.set(downloadId, download);
    this.notifyListeners();
    this.processQueue();

    return downloadId;
  }

  /**
   * Process download queue
   */
  private async processQueue(): Promise<void> {
    if (this.state.isPaused || this.state.activeDownloadId || this.currentDownloadPromise) {
      return;
    }

    // Find next pending download
    const pendingDownload = Array.from(this.state.downloads.values()).find(
      d => d.status === 'pending'
    );

    if (!pendingDownload) return;

    // Start download
    this.state.activeDownloadId = pendingDownload.id;
    pendingDownload.status = 'downloading';
    pendingDownload.startedAt = Date.now();
    this.notifyListeners();

    this.currentDownloadPromise = this.executeDownload(pendingDownload)
      .finally(() => {
        this.state.activeDownloadId = undefined;
        this.currentDownloadPromise = undefined;
        this.processQueue();
      });
  }

  /**
   * Execute single download
   */
  private async executeDownload(download: DownloadItem): Promise<void> {
    try {
      // Determine source type for rate limiting
      const sourceType: SourceProviderType = download.result.sourceType;

      // Create download executor with rate limiting
      await rateLimiter.queueRequest(
        download.id,
        async () => {
          // Simulated download (replace with actual implementation)
          await this.simulateDownload(download);
        },
        sourceType
      );

      download.status = 'completed';
      download.progress = 100;
      download.completedAt = Date.now();
    } catch (error) {
      download.status = 'error';
      download.error = error instanceof Error ? error.message : 'Download failed';
    }

    this.notifyListeners();
  }

  /**
   * Simulate download progress (replace with actual implementation)
   */
  private async simulateDownload(download: DownloadItem): Promise<void> {
    const totalSize = 1024 * 1024 * 5; // 5MB simulated
    const chunkSize = 1024 * 100; // 100KB chunks
    download.totalBytes = totalSize;

    let downloaded = 0;
    const startTime = Date.now();

    while (downloaded < totalSize) {
      if (download.status === 'cancelled') {
        throw new Error('Download cancelled');
      }

      if (download.status === 'paused') {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }

      // Simulate chunk download
      await new Promise(resolve => setTimeout(resolve, 100));
      
      downloaded = Math.min(downloaded + chunkSize, totalSize);
      download.downloadedBytes = downloaded;
      download.progress = (downloaded / totalSize) * 100;

      // Calculate speed and ETA
      const elapsed = (Date.now() - startTime) / 1000;
      download.speed = downloaded / elapsed;
      const remaining = totalSize - downloaded;
      download.eta = remaining / download.speed;

      this.notifyListeners();
    }
  }

  /**
   * Pause download
   */
  pauseDownload(downloadId: string): void {
    const download = this.state.downloads.get(downloadId);
    if (download && download.status === 'downloading') {
      download.status = 'paused';
      this.notifyListeners();
    }
  }

  /**
   * Resume download
   */
  resumeDownload(downloadId: string): void {
    const download = this.state.downloads.get(downloadId);
    if (download && download.status === 'paused') {
      download.status = 'pending';
      this.notifyListeners();
      this.processQueue();
    }
  }

  /**
   * Cancel download
   */
  cancelDownload(downloadId: string): void {
    const download = this.state.downloads.get(downloadId);
    if (download && ['pending', 'downloading', 'paused'].includes(download.status)) {
      download.status = 'cancelled';
      this.notifyListeners();
    }
  }

  /**
   * Retry failed download
   */
  retryDownload(downloadId: string): void {
    const download = this.state.downloads.get(downloadId);
    if (download && download.status === 'error') {
      download.status = 'pending';
      download.error = undefined;
      download.progress = 0;
      download.downloadedBytes = 0;
      this.notifyListeners();
      this.processQueue();
    }
  }

  /**
   * Remove download from queue
   */
  removeDownload(downloadId: string): void {
    this.state.downloads.delete(downloadId);
    this.notifyListeners();
  }

  /**
   * Clear completed downloads
   */
  clearCompleted(): void {
    for (const [id, download] of this.state.downloads.entries()) {
      if (['completed', 'cancelled', 'error'].includes(download.status)) {
        this.state.downloads.delete(id);
      }
    }
    this.notifyListeners();
  }

  /**
   * Pause all downloads
   */
  pauseAll(): void {
    this.state.isPaused = true;
    for (const download of this.state.downloads.values()) {
      if (download.status === 'downloading') {
        download.status = 'paused';
      }
    }
    this.notifyListeners();
  }

  /**
   * Resume all downloads
   */
  resumeAll(): void {
    this.state.isPaused = false;
    for (const download of this.state.downloads.values()) {
      if (download.status === 'paused') {
        download.status = 'pending';
      }
    }
    this.notifyListeners();
    this.processQueue();
  }

  /**
   * Get download by ID
   */
  getDownload(downloadId: string): DownloadItem | undefined {
    return this.state.downloads.get(downloadId);
  }

  /**
   * Get all downloads
   */
  getAllDownloads(): DownloadItem[] {
    return Array.from(this.state.downloads.values());
  }

  /**
   * Get active downloads
   */
  getActiveDownloads(): DownloadItem[] {
    return Array.from(this.state.downloads.values()).filter(
      d => d.status === 'downloading' || d.status === 'pending'
    );
  }

  /**
   * Subscribe to queue updates
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Notify all listeners
   */
  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  /**
   * Get queue statistics
   */
  getStats(): {
    total: number;
    pending: number;
    downloading: number;
    completed: number;
    paused: number;
    error: number;
    cancelled: number;
  } {
    const stats = {
      total: this.state.downloads.size,
      pending: 0,
      downloading: 0,
      completed: 0,
      paused: 0,
      error: 0,
      cancelled: 0,
    };

    for (const download of this.state.downloads.values()) {
      stats[download.status]++;
    }

    return stats;
  }
}

// Export singleton instance
export const downloadQueue = DownloadQueue.getInstance();
