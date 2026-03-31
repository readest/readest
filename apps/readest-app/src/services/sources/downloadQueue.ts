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
  /** Called with the downloaded File after a successful download */
  onComplete?: (file: File) => Promise<void>;
  /** The downloaded file, available after status === 'completed' */
  fileResult?: File;
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
  async addDownload(
    result: SourceSearchResult,
    options?: { onComplete?: (file: File) => Promise<void> },
  ): Promise<string> {
    const downloadId = `download-${result.sourceId}-${result.id}-${Date.now()}`;

    // Get download URL
    let downloadUrl = result.downloadUrl;
    if (!downloadUrl) {
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
      onComplete: options?.onComplete,
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
      const sourceType: SourceProviderType = download.result.sourceType;

      await rateLimiter.queueRequest(
        download.id,
        async () => {
          await this.realDownload(download);
        },
        sourceType,
      );

      download.status = 'completed';
      download.progress = 100;
      download.completedAt = Date.now();
      this.notifyListeners();

      // Fire completion callback after status is updated
      if (download.onComplete && download.fileResult) {
        await download.onComplete(download.fileResult);
      }
    } catch (error) {
      download.status = 'error';
      download.error = error instanceof Error ? error.message : 'Download failed';
      this.notifyListeners();
    }
  }

  /**
   * Extract a direct file URL from an HTML interstitial page
   * (e.g. libgen.li/ads.php returns an HTML page with a download link)
   */
  private extractFileUrlFromHtml(html: string, pageUrl: string): string | null {
    const base = new URL(pageUrl);

    // Pattern 1: get.php?md5=...&key=... (libgen.li ads page)
    const getPhpMatch = html.match(/href=["']([^"']*get\.php\?[^"']*)["']/i);
    if (getPhpMatch) {
      const href = getPhpMatch[1];
      if (href.startsWith('http')) return href;
      return `${base.origin}${href.startsWith('/') ? '' : '/'}${href}`;
    }

    // Pattern 2: direct link ending with a known ebook extension
    const directMatch = html.match(
      /href=["']([^"']+\.(?:epub|pdf|djvu|mobi|fb2|azw3|cbz|cbr|doc|docx|txt|rtf))["']/i,
    );
    if (directMatch) {
      const href = directMatch[1];
      if (href.startsWith('http')) return href;
      return `${base.origin}${href.startsWith('/') ? '' : '/'}${href}`;
    }

    return null;
  }

  /**
   * Download a file for real, streaming bytes with progress tracking.
   * Handles HTML interstitial pages (e.g. libgen ads pages) automatically.
   */
  private async realDownload(download: DownloadItem): Promise<void> {
    // Step 1: fetch the download URL through the proxy
    let fetchUrl = download.url;
    let proxyUrl = `/api/shadow-library/proxy?url=${encodeURIComponent(fetchUrl)}`;
    let response = await fetch(proxyUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Step 2: if we got an HTML page, extract the real file URL and re-fetch
    const contentType = response.headers.get('content-type') || '';
    if (contentType.startsWith('text/html')) {
      const html = await response.text();
      const resolved = this.extractFileUrlFromHtml(html, fetchUrl);
      if (resolved) {
        fetchUrl = resolved;
        proxyUrl = `/api/shadow-library/proxy?url=${encodeURIComponent(fetchUrl)}`;
        response = await fetch(proxyUrl);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
      } else {
        throw new Error('Could not find a download link on the page');
      }
    }

    const contentLength = Number(response.headers.get('content-length') || 0);
    download.totalBytes = contentLength;

    // Step 3: stream bytes with progress updates
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let downloaded = 0;
    const startTime = Date.now();

    if (reader) {
      while (true) {
        if (download.status === 'cancelled') {
          reader.cancel();
          throw new Error('Download cancelled');
        }
        while (download.status === 'paused') {
          await new Promise<void>((resolve) => setTimeout(resolve, 500));
        }

        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        downloaded += value.length;
        download.downloadedBytes = downloaded;
        if (contentLength > 0) {
          download.progress = (downloaded / contentLength) * 100;
        }

        const elapsed = (Date.now() - startTime) / 1000;
        download.speed = elapsed > 0 ? downloaded / elapsed : 0;
        download.eta =
          download.speed > 0 && contentLength > 0
            ? (contentLength - downloaded) / download.speed
            : 0;

        this.notifyListeners();
      }
    } else {
      // Fallback: read entire body at once (no streaming progress)
      const buffer = await response.arrayBuffer();
      chunks.push(new Uint8Array(buffer));
      downloaded = buffer.byteLength;
    }

    // Step 4: build a File object with the correct name and MIME type
    const ext = (download.result.format ?? 'epub').toLowerCase();
    const safeName = (download.result.title ?? 'download').replace(/[/\\:*?"<>|]/g, '_');
    const filename = `${safeName}.${ext}`;
    const mimeTypes: Record<string, string> = {
      epub: 'application/epub+zip',
      pdf: 'application/pdf',
      mobi: 'application/x-mobipocket-ebook',
      djvu: 'image/vnd.djvu',
      fb2: 'application/x-fictionbook+xml',
      azw3: 'application/vnd.amazon.ebook',
    };
    const mimeType = mimeTypes[ext] ?? 'application/octet-stream';
    const file = new File(chunks, filename, { type: mimeType });

    download.fileResult = file;
    download.downloadedBytes = downloaded;
    download.totalBytes = downloaded;
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
