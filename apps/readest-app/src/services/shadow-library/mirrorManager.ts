/**
 * Mirror Manager Service
 * 
 * Handles mirror domain health checking, automatic failover,
 * and domain rotation for shadow library providers.
 */

import {
  MirrorDomain,
  ShadowLibraryProvider,
  ShadowLibrarySettings,
  DEFAULT_SHADOW_LIBRARY_SETTINGS,
} from '@/types/shadow-library';
import { isTauriAppPlatform } from '@/services/environment';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

export class MirrorManager {
  private static instance: MirrorManager;
  private settings: ShadowLibrarySettings;
  private healthCheckTimers: Map<string, NodeJS.Timeout> = new Map();
  private ongoingChecks: Map<string, Promise<void>> = new Map();

  private constructor() {
    this.settings = { ...DEFAULT_SHADOW_LIBRARY_SETTINGS };
  }

  static getInstance(): MirrorManager {
    if (!MirrorManager.instance) {
      MirrorManager.instance = new MirrorManager();
    }
    return MirrorManager.instance;
  }

  /**
   * Initialize with user settings
   */
  initialize(settings: ShadowLibrarySettings): void {
    this.settings = settings;
    this.startHealthChecks();
  }

  /**
   * Update settings
   */
  updateSettings(settings: Partial<ShadowLibrarySettings>): void {
    this.settings = { ...this.settings, ...settings };
    
    if (settings.providers) {
      this.restartHealthChecks();
    }
  }

  /**
   * Get active mirror for a provider
   */
  getActiveMirror(provider: ShadowLibraryProvider): MirrorDomain | null {
    if (provider.mirrors.length === 0) return null;
    
    // Return currently active mirror if valid
    const activeMirror = provider.mirrors[provider.activeMirrorIndex];
    if (activeMirror && activeMirror.isActive) {
      return activeMirror;
    }

    // Find first available mirror by priority
    const availableMirror = provider.mirrors.find(m => m.isActive);
    if (availableMirror) {
      return availableMirror;
    }

    // All mirrors inactive - return highest priority anyway
    return provider.mirrors.reduce((best, current) => 
      current.priority < best.priority ? current : best
    );
  }

  /**
   * Get next available mirror (for failover)
   */
  getNextMirror(provider: ShadowLibraryProvider): MirrorDomain | null {
    const sortedMirrors = [...provider.mirrors].sort((a, b) => a.priority - b.priority);
    
    for (const mirror of sortedMirrors) {
      if (mirror.isActive && mirror.url !== this.getActiveMirror(provider)?.url) {
        return mirror;
      }
    }
    
    return null;
  }

  /**
   * Switch to next available mirror
   */
  async switchMirror(provider: ShadowLibraryProvider): Promise<boolean> {
    const nextMirror = this.getNextMirror(provider);
    if (!nextMirror) {
      console.warn(`[MirrorManager] No available mirrors for ${provider.name}`);
      return false;
    }

    const currentIndex = provider.mirrors.findIndex(m => m.url === nextMirror.url);
    if (currentIndex === -1) return false;

    provider.activeMirrorIndex = currentIndex;
    console.log(`[MirrorManager] Switched ${provider.name} to ${nextMirror.url}`);
    
    return true;
  }

  /**
   * Mark mirror as failed
   */
  markMirrorFailed(provider: ShadowLibraryProvider, mirrorUrl: string, reason?: string): void {
    const mirror = provider.mirrors.find(m => m.url === mirrorUrl);
    if (!mirror) return;

    mirror.failureCount++;
    mirror.lastChecked = Date.now();
    mirror.reason = reason;

    if (mirror.failureCount >= this.settings.maxMirrorFailures) {
      mirror.isActive = false;
      console.warn(`[MirrorManager] Marked ${mirrorUrl} as inactive (${mirror.failureCount} failures)`);
      
      // Auto-switch if enabled
      if (this.settings.autoSwitchMirror) {
        this.switchMirror(provider);
      }
    }
  }

  /**
   * Mark mirror as successful
   */
  markMirrorSuccess(provider: ShadowLibraryProvider, mirrorUrl: string, responseTime?: number): void {
    const mirror = provider.mirrors.find(m => m.url === mirrorUrl);
    if (!mirror) return;

    mirror.failureCount = 0;
    mirror.lastChecked = Date.now();
    mirror.lastSuccess = Date.now();
    mirror.isActive = true;
    
    if (responseTime !== undefined) {
      mirror.responseTime = responseTime;
    }
  }

  /**
   * Check health of a single mirror
   */
  private async checkMirrorHealth(
    provider: ShadowLibraryProvider,
    mirror: MirrorDomain
  ): Promise<void> {
    const startTime = Date.now();
    
    try {
      // Use HEAD request to check availability
      const fetchFn = isTauriAppPlatform() ? tauriFetch : window.fetch;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetchFn(mirror.url, {
        method: 'HEAD',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Readest/1.0 (Shadow Library Client)',
        },
      });

      clearTimeout(timeoutId);
      const responseTime = Date.now() - startTime;

      if (response.ok || response.status === 404) {
        // 404 is okay - means server is responding
        this.markMirrorSuccess(provider, mirror.url, responseTime);
        console.log(`[MirrorManager] ${mirror.url} is healthy (${responseTime}ms)`);
      } else {
        this.markMirrorFailed(provider, mirror.url, `HTTP ${response.status}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.markMirrorFailed(provider, mirror.url, errorMessage);
      console.warn(`[MirrorManager] ${mirror.url} failed: ${errorMessage}`);
    }
  }

  /**
   * Check health of all mirrors for a provider
   */
  async checkProviderHealth(provider: ShadowLibraryProvider): Promise<MirrorDomain[]> {
    const checkKey = provider.id;
    
    // Prevent concurrent checks
    if (this.ongoingChecks.has(checkKey)) {
      return provider.mirrors;
    }

    const checkPromise = (async () => {
      try {
        await Promise.all(
          provider.mirrors.map(mirror => this.checkMirrorHealth(provider, mirror))
        );
      } finally {
        this.ongoingChecks.delete(checkKey);
      }
    })();

    this.ongoingChecks.set(checkKey, checkPromise);
    await checkPromise;
    
    return provider.mirrors;
  }

  /**
   * Start periodic health checks
   */
  private startHealthChecks(): void {
    this.stopHealthChecks();

    for (const provider of this.settings.providers) {
      if (!provider.disabled && provider.capabilities.supportsMirrors) {
        this.scheduleProviderHealthCheck(provider);
      }
    }
  }

  /**
   * Schedule health check for a provider
   */
  private scheduleProviderHealthCheck(provider: ShadowLibraryProvider): void {
    const timeoutId = setTimeout(async () => {
      await this.checkProviderHealth(provider);
      this.scheduleProviderHealthCheck(provider);
    }, this.settings.mirrorCheckInterval);

    this.healthCheckTimers.set(provider.id, timeoutId);
  }

  /**
   * Stop all health checks
   */
  private stopHealthChecks(): void {
    for (const timer of this.healthCheckTimers.values()) {
      clearTimeout(timer);
    }
    this.healthCheckTimers.clear();
  }

  /**
   * Restart health checks (after settings change)
   */
  private restartHealthChecks(): void {
    this.stopHealthChecks();
    this.startHealthChecks();
  }

  /**
   * Get provider by ID
   */
  getProvider(providerId: string): ShadowLibraryProvider | undefined {
    return this.settings.providers.find(p => p.id === providerId);
  }

  /**
   * Get all enabled providers
   */
  getEnabledProviders(): ShadowLibraryProvider[] {
    return this.settings.providers.filter(p => !p.disabled);
  }

  /**
   * Get providers by type
   */
  getProvidersByType(type: string): ShadowLibraryProvider[] {
    return this.settings.providers.filter(p => p.type === type && !p.disabled);
  }

  /**
   * Get DOI resolver providers in priority order
   */
  getDOIRsolvers(): ShadowLibraryProvider[] {
    const { doiResolutionOrder } = this.settings;
    
    const providers = this.settings.providers.filter(
      p => p.capabilities.doiLookup && !p.disabled
    );

    // Sort by user-defined order
    return providers.sort((a, b) => {
      const aIndex = doiResolutionOrder.indexOf(a.id);
      const bIndex = doiResolutionOrder.indexOf(b.id);
      
      if (aIndex === -1 && bIndex === -1) return 0;
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });
  }

  /**
   * Add custom provider
   */
  addProvider(provider: ShadowLibraryProvider): void {
    const existingIndex = this.settings.providers.findIndex(p => p.id === provider.id);
    
    if (existingIndex !== -1) {
      // Update existing
      this.settings.providers[existingIndex] = provider;
    } else {
      // Add new
      this.settings.providers.push(provider);
    }

    if (!provider.disabled && provider.capabilities.supportsMirrors) {
      this.scheduleProviderHealthCheck(provider);
    }
  }

  /**
   * Remove provider
   */
  removeProvider(providerId: string): void {
    this.settings.providers = this.settings.providers.filter(p => p.id !== providerId);
    
    // Stop health checks for removed provider
    const timer = this.healthCheckTimers.get(providerId);
    if (timer) {
      clearTimeout(timer);
      this.healthCheckTimers.delete(providerId);
    }
  }

  /**
   * Get current settings
   */
  getSettings(): ShadowLibrarySettings {
    return { ...this.settings };
  }

  /**
   * Cleanup on unmount
   */
  destroy(): void {
    this.stopHealthChecks();
  }
}

// Export singleton instance
export const mirrorManager = MirrorManager.getInstance();
