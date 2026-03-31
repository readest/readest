/**
 * Rate Limiter Service
 * 
 * Manages request rate limiting across all sources to prevent
 * overwhelming servers and getting blocked.
 */

import { RateLimitConfig, DEFAULT_RATE_LIMITS, SourceProviderType } from '@/types/sources';

interface RequestQueueItem {
  id: string;
  execute: () => Promise<any>;
  resolve: (value: any) => void;
  reject: (error: any) => void;
  sourceType: SourceProviderType;
  createdAt: number;
}

interface RateLimitState {
  // Token bucket for per-second limiting
  tokens: number;
  lastRefill: number;
  
  // Request tracking
  requestsThisSecond: number;
  requestsThisMinute: number;
  requestsThisHour: number;
  
  // Window tracking
  secondWindowStart: number;
  minuteWindowStart: number;
  hourWindowStart: number;
}

/**
 * Rate limiter for a single source type
 */
class SourceRateLimiter {
  private config: RateLimitConfig;
  private state: RateLimitState;
  private queue: RequestQueueItem[] = [];
  private processing = false;
  private activeRequests = 0;

  constructor(sourceType: SourceProviderType, config?: Partial<RateLimitConfig>) {
    this.config = { ...DEFAULT_RATE_LIMITS[sourceType], ...config };
    this.state = this.createInitialState();
  }

  private createInitialState(): RateLimitState {
    return {
      tokens: this.config.requestsPerSecond,
      lastRefill: Date.now(),
      requestsThisSecond: 0,
      requestsThisMinute: 0,
      requestsThisHour: 0,
      secondWindowStart: Date.now(),
      minuteWindowStart: Date.now(),
      hourWindowStart: Date.now(),
    };
  }

  /**
   * Queue a request for execution
   */
  async queueRequest<T>(
    id: string,
    execute: () => Promise<T>,
    sourceType: SourceProviderType
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const item: RequestQueueItem = {
        id,
        execute,
        resolve,
        reject,
        sourceType,
        createdAt: Date.now(),
      };
      this.queue.push(item);
      this.processQueue();
    });
  }

  /**
   * Process the request queue
   */
  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0 && this.activeRequests < this.config.concurrentRequests) {
      // Check rate limits
      if (!this.canMakeRequest()) {
        const waitTime = this.getWaitTime();
        await this.sleep(waitTime);
      }

      const item = this.queue.shift();
      if (!item) break;

      this.activeRequests++;
      this.recordRequest();

      // Execute request with timeout
      this.executeWithTimeout(item)
        .finally(() => {
          this.activeRequests--;
          this.processQueue();
        });
    }

    this.processing = false;
  }

  /**
   * Execute request with timeout
   */
  private async executeWithTimeout(item: RequestQueueItem): Promise<void> {
    const timeoutId = setTimeout(() => {
      item.reject(new Error(`Request timeout after ${this.config.timeoutMs}ms`));
    }, this.config.timeoutMs);

    try {
      const result = await item.execute();
      clearTimeout(timeoutId);
      item.resolve(result);
    } catch (error) {
      clearTimeout(timeoutId);
      item.reject(error);
    }
  }

  /**
   * Check if we can make a request
   */
  private canMakeRequest(): boolean {
    this.refillTokens();
    this.updateWindows();

    return (
      this.state.tokens >= 1 &&
      this.state.requestsThisSecond < this.config.requestsPerSecond &&
      this.state.requestsThisMinute < this.config.requestsPerMinute &&
      this.state.requestsThisHour < this.config.requestsPerHour
    );
  }

  /**
   * Get time to wait before next request
   */
  private getWaitTime(): number {
    this.refillTokens();
    this.updateWindows();

    const now = Date.now();

    if (this.state.tokens < 1) {
      return Math.max(0, 1000 - (now - this.state.lastRefill));
    }

    if (this.state.requestsThisSecond >= this.config.requestsPerSecond) {
      return Math.max(0, 1000 - (now - this.state.secondWindowStart));
    }

    if (this.state.requestsThisMinute >= this.config.requestsPerMinute) {
      return Math.max(0, 60000 - (now - this.state.minuteWindowStart));
    }

    if (this.state.requestsThisHour >= this.config.requestsPerHour) {
      return Math.max(0, 3600000 - (now - this.state.hourWindowStart));
    }

    return 0;
  }

  /**
   * Record a request for rate limiting
   */
  private recordRequest(): void {
    const now = Date.now();
    this.state.tokens -= 1;
    this.state.requestsThisSecond++;
    this.state.requestsThisMinute++;
    this.state.requestsThisHour++;

    // Reset windows if needed
    if (now - this.state.secondWindowStart >= 1000) {
      this.state.secondWindowStart = now;
      this.state.requestsThisSecond = 0;
    }

    if (now - this.state.minuteWindowStart >= 60000) {
      this.state.minuteWindowStart = now;
      this.state.requestsThisMinute = 0;
    }

    if (now - this.state.hourWindowStart >= 3600000) {
      this.state.hourWindowStart = now;
      this.state.requestsThisHour = 0;
    }
  }

  /**
   * Refill tokens based on elapsed time
   */
  private refillTokens(): void {
    const now = Date.now();
    const elapsed = now - this.state.lastRefill;
    const tokensToAdd = (elapsed / 1000) * this.config.requestsPerSecond;

    this.state.tokens = Math.min(this.config.requestsPerSecond, this.state.tokens + tokensToAdd);
    this.state.lastRefill = now;
  }

  /**
   * Update time windows
   */
  private updateWindows(): void {
    const now = Date.now();

    if (now - this.state.secondWindowStart >= 1000) {
      this.state.secondWindowStart = now;
      this.state.requestsThisSecond = 0;
    }

    if (now - this.state.minuteWindowStart >= 60000) {
      this.state.minuteWindowStart = now;
      this.state.requestsThisMinute = 0;
    }

    if (now - this.state.hourWindowStart >= 3600000) {
      this.state.hourWindowStart = now;
      this.state.requestsThisHour = 0;
    }
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get current rate limit status
   */
  getStatus(): {
    tokens: number;
    requestsThisSecond: number;
    requestsThisMinute: number;
    requestsThisHour: number;
    queueLength: number;
    activeRequests: number;
    canMakeRequest: boolean;
    waitTime: number;
  } {
    this.refillTokens();
    this.updateWindows();

    return {
      tokens: this.state.tokens,
      requestsThisSecond: this.state.requestsThisSecond,
      requestsThisMinute: this.state.requestsThisMinute,
      requestsThisHour: this.state.requestsThisHour,
      queueLength: this.queue.length,
      activeRequests: this.activeRequests,
      canMakeRequest: this.canMakeRequest(),
      waitTime: this.getWaitTime(),
    };
  }

  /**
   * Clear the queue
   */
  clearQueue(): void {
    const error = new Error('Queue cleared');
    for (const item of this.queue) {
      item.reject(error);
    }
    this.queue = [];
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<RateLimitConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

/**
 * Main rate limiter service managing all source types
 */
export class RateLimiterService {
  private static instance: RateLimiterService;
  private limiters: Map<SourceProviderType, SourceRateLimiter> = new Map();
  private globalConfig: Partial<RateLimitConfig> = {};

  private constructor() {}

  static getInstance(): RateLimiterService {
    if (!RateLimiterService.instance) {
      RateLimiterService.instance = new RateLimiterService();
    }
    return RateLimiterService.instance;
  }

  /**
   * Get or create rate limiter for source type
   */
  private getLimiter(sourceType: SourceProviderType): SourceRateLimiter {
    if (!this.limiters.has(sourceType)) {
      const limiter = new SourceRateLimiter(sourceType, this.globalConfig);
      this.limiters.set(sourceType, limiter);
    }
    return this.limiters.get(sourceType)!;
  }

  /**
   * Queue a request with rate limiting
   */
  async queueRequest<T>(
    id: string,
    execute: () => Promise<T>,
    sourceType: SourceProviderType
  ): Promise<T> {
    const limiter = this.getLimiter(sourceType);
    return limiter.queueRequest(id, execute, sourceType);
  }

  /**
   * Execute multiple requests with concurrency control
   */
  async executeBatch<T>(
    requests: Array<{ id: string; execute: () => Promise<T>; sourceType: SourceProviderType }>,
    options?: { stopOnError?: boolean }
  ): Promise<Array<{ id: string; result?: T; error?: any }>> {
    const results: Array<{ id: string; result?: T; error?: any }> = [];
    const stopOnError = options?.stopOnError ?? false;

    const promises = requests.map(async req => {
      try {
        const result = await this.queueRequest(req.id, req.execute, req.sourceType);
        results.push({ id: req.id, result });
      } catch (error) {
        results.push({ id: req.id, error });
        if (stopOnError) {
          throw error;
        }
      }
    });

    await Promise.allSettled(promises);
    return results;
  }

  /**
   * Get status for all source types
   */
  getStatus(): Record<SourceProviderType, ReturnType<SourceRateLimiter['getStatus']>> {
    const status: any = {};
    for (const sourceType of Object.values(SourceProviderType)) {
      const limiter = this.getLimiter(sourceType);
      status[sourceType] = limiter.getStatus();
    }
    return status;
  }

  /**
   * Update global rate limit config
   */
  updateConfig(config: Partial<RateLimitConfig>): void {
    this.globalConfig = config;
    for (const limiter of this.limiters.values()) {
      limiter.updateConfig(config);
    }
  }

  /**
   * Clear all queues
   */
  clearAllQueues(): void {
    for (const limiter of this.limiters.values()) {
      limiter.clearQueue();
    }
  }

  /**
   * Get queue statistics
   */
  getStats(): {
    totalQueued: number;
    totalActive: number;
    bySourceType: Record<SourceProviderType, { queued: number; active: number }>;
  } {
    const stats: any = {
      totalQueued: 0,
      totalActive: 0,
      bySourceType: {} as any,
    };

    for (const [sourceType, limiter] of this.limiters.entries()) {
      const status = limiter.getStatus();
      stats.bySourceType[sourceType] = {
        queued: status.queueLength,
        active: status.activeRequests,
      };
      stats.totalQueued += status.queueLength;
      stats.totalActive += status.activeRequests;
    }

    return stats;
  }
}

// Export singleton instance
export const rateLimiter = RateLimiterService.getInstance();
