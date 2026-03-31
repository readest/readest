/**
 * Shadow Library Provider Base Class
 * 
 * Abstract base class that all shadow library providers must extend.
 * Provides common functionality for mirror management, authentication,
 * and request handling.
 */

import {
  ShadowLibraryProvider,
  MirrorDomain,
  ShadowLibrarySearchQuery,
  ShadowLibrarySearchResult,
  DOIResolutionResult,
  IShadowLibraryProvider,
} from '@/types/shadow-library';
import { mirrorManager } from './mirrorManager';
import { isTauriAppPlatform } from '@/services/environment';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

/**
 * API proxy URL for shadow library requests
 */
const SHADOW_LIBRARY_PROXY_URL = '/api/shadow-library/proxy';

/**
 * Get the appropriate fetch function based on platform
 */
function getFetchFn() {
  return isTauriAppPlatform() ? tauriFetch : window.fetch;
}

/**
 * Extract domain from URL
 */
function getDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return url;
  }
}

/**
 * Abstract base class for shadow library providers
 */
export abstract class ShadowLibraryProviderBase implements IShadowLibraryProvider {
  protected provider: ShadowLibraryProvider;

  constructor(provider: ShadowLibraryProvider) {
    this.provider = provider;
  }

  /**
   * Get provider ID
   */
  getId(): string {
    return this.provider.id;
  }

  /**
   * Get provider name
   */
  getName(): string {
    return this.provider.name;
  }

  /**
   * Get active mirror
   */
  getActiveMirror(): MirrorDomain | null {
    return mirrorManager.getActiveMirror(this.provider);
  }

  /**
   * Get active mirror URL
   */
  getActiveMirrorUrl(): string | null {
    const mirror = this.getActiveMirror();
    return mirror?.url || null;
  }

  /**
   * Switch to next available mirror
   */
  async switchMirror(): Promise<boolean> {
    const success = await mirrorManager.switchMirror(this.provider);
    if (success) {
      console.log(`[ShadowLibrary] ${this.provider.name} switched to ${this.getActiveMirrorUrl()}`);
    }
    return success;
  }

  /**
   * Check mirror health
   */
  async checkMirrorHealth(): Promise<MirrorDomain[]> {
    return mirrorManager.checkProviderHealth(this.provider);
  }

  /**
   * Get proxied URL for web platform
   */
  protected getProxiedURL(url: string, params?: Record<string, string>): string {
    const proxiedUrl = `${SHADOW_LIBRARY_PROXY_URL}?url=${encodeURIComponent(url)}`;
    
    if (params) {
      const paramStr = Object.entries(params)
        .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
        .join('&');
      return `${proxiedUrl}&${paramStr}`;
    }
    
    return proxiedUrl;
  }

  /**
   * Make authenticated request
   */
  protected async makeRequest(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const baseUrl = this.getActiveMirrorUrl();
    if (!baseUrl) {
      throw new Error('No active mirror available');
    }

    const url = endpoint.startsWith('http') ? endpoint : `${baseUrl}${endpoint}`;
    
    // On web platform, always use proxy to avoid CORS
    if (!isTauriAppPlatform()) {
      const proxiedUrl = this.getProxiedURL(url);
      console.log(`[ShadowLibrary] ${this.provider.name} requesting via proxy: ${proxiedUrl}`);
      
      try {
        const response = await window.fetch(proxiedUrl, {
          ...options,
          method: options.method || 'GET',
        });
        
        console.log(`[ShadowLibrary] ${this.provider.name} got response: ${response.status}`);
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[ShadowLibrary] ${this.provider.name} error:`, errorText);
          mirrorManager.markMirrorFailed(this.provider, baseUrl, `HTTP ${response.status}`);
          throw new Error(`Request failed with status ${response.status}`);
        }
        
        mirrorManager.markMirrorSuccess(this.provider, baseUrl);
        return response;
      } catch (error) {
        console.error(`[ShadowLibrary] ${this.provider.name} fetch error:`, error);
        throw error;
      }
    }
    
    // Tauri app - use direct fetch
    const fetchFn = getFetchFn();
    const headers: Record<string, string> = {
      'User-Agent': 'Readest/1.0 (Shadow Library Client)',
      Accept: 'application/json, text/html, */*',
      ...(options.headers as Record<string, string>),
    };

    // Add authentication if available
    if (this.provider.username && this.provider.password) {
      const credentials = btoa(`${this.provider.username}:${this.provider.password}`);
      headers['Authorization'] = `Basic ${credentials}`;
    }

    if (this.provider.apiKey) {
      headers['X-API-Key'] = this.provider.apiKey;
    }

    try {
      const response = await fetchFn(url, {
        ...options,
        headers,
        credentials: 'include',
      });

      // Handle mirror failure
      if (!response.ok && (response.status === 403 || response.status === 503)) {
        mirrorManager.markMirrorFailed(this.provider, baseUrl, `HTTP ${response.status}`);

        // Auto-switch mirror if enabled
        const settings = mirrorManager.getSettings();
        if (settings.autoSwitchMirror) {
          await this.switchMirror();
          // Retry with new mirror
          return this.makeRequest(endpoint, options);
        }
      }

      // Mark success
      mirrorManager.markMirrorSuccess(this.provider, baseUrl);

      return response;
    } catch (error) {
      mirrorManager.markMirrorFailed(
        this.provider,
        baseUrl,
        error instanceof Error ? error.message : 'Network error'
      );
      throw error;
    }
  }

  /**
   * Parse HTML response
   */
  protected async parseHTML(response: Response): Promise<Document> {
    const text = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'text/html');
    return doc;
  }

  /**
   * Parse JSON response
   */
  protected async parseJSON<T>(response: Response): Promise<T> {
    return response.json();
  }

  /**
   * Validate provider configuration
   */
  async validate(): Promise<{ valid: boolean; error?: string }> {
    try {
      const mirror = this.getActiveMirror();
      if (!mirror) {
        return { valid: false, error: 'No active mirror configured' };
      }

      const response = await this.makeRequest(mirror.url, { method: 'HEAD' });
      
      if (response.ok || response.status === 404) {
        return { valid: true };
      } else {
        return { valid: false, error: `Server returned ${response.status}` };
      }
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      };
    }
  }

  /**
   * Search the library (must be implemented by subclass)
   */
  abstract search(query: ShadowLibrarySearchQuery): Promise<ShadowLibrarySearchResult[]>;

  /**
   * Get download URL (must be implemented by subclass)
   */
  abstract getDownloadUrl(resultId: string): Promise<string>;

  /**
   * Get streaming URL (optional - override if provider supports it)
   */
  async getStreamingUrl(resultId: string): Promise<string | null> {
    if (!this.provider.capabilities.streaming) {
      return null;
    }
    
    // Default implementation - subclass should override
    console.warn(`[ShadowLibrary] ${this.provider.name} does not implement streaming`);
    return null;
  }

  /**
   * Resolve DOI (optional - override if provider supports it)
   */
  async resolveDOI(doi: string): Promise<DOIResolutionResult> {
    if (!this.provider.capabilities.doiLookup) {
      return {
        success: false,
        providerId: this.provider.id,
        fallbackAvailable: false,
        error: 'DOI lookup not supported',
      };
    }

    // Default implementation - subclass should override
    console.warn(`[ShadowLibrary] ${this.provider.name} does not implement DOI resolution`);
    return {
      success: false,
      providerId: this.provider.id,
      fallbackAvailable: false,
      error: 'DOI resolution not implemented',
    };
  }

  /**
   * Get provider settings
   */
  getSetting<T>(key: string): T | undefined {
    return this.provider.settings[key] as T | undefined;
  }

  /**
   * Set provider setting
   */
  setSetting(key: string, value: string | boolean | number): void {
    this.provider.settings[key] = value;
  }

  /**
   * Update provider
   */
  updateProvider(provider: ShadowLibraryProvider): void {
    this.provider = provider;
  }
}

/**
 * Provider registry for managing provider instances
 */
export class ProviderRegistry {
  private static instance: ProviderRegistry;
  private providers: Map<string, ShadowLibraryProviderBase> = new Map();
  private providerClasses: Map<string, new (p: ShadowLibraryProvider) => ShadowLibraryProviderBase> =
    new Map();

  private constructor() {}

  static getInstance(): ProviderRegistry {
    if (!ProviderRegistry.instance) {
      ProviderRegistry.instance = new ProviderRegistry();
    }
    return ProviderRegistry.instance;
  }

  /**
   * Register a provider class
   */
  register(
    providerId: string,
    ProviderClass: new (p: ShadowLibraryProvider) => ShadowLibraryProviderBase
  ): void {
    this.providerClasses.set(providerId, ProviderClass);
    console.log(`[ProviderRegistry] Registered provider class: ${providerId}`);
  }

  /**
   * Get or create provider instance
   */
  getProvider(providerId: string): ShadowLibraryProviderBase | null {
    // Check cache
    const cached = this.providers.get(providerId);
    if (cached) {
      return cached;
    }

    // Get provider config
    const settings = mirrorManager.getSettings();
    const providerConfig = settings.providers.find(p => p.id === providerId);

    if (!providerConfig) {
      console.warn(`[ProviderRegistry] Provider not found: ${providerId}`);
      return null;
    }

    // Get provider class
    const ProviderClass = this.providerClasses.get(providerId);
    if (!ProviderClass) {
      console.warn(`[ProviderRegistry] No class registered for: ${providerId}`);
      return null;
    }

    // Create instance
    const instance = new ProviderClass(providerConfig);
    this.providers.set(providerId, instance);

    return instance;
  }

  /**
   * Get all provider instances
   */
  getAllProviders(): ShadowLibraryProviderBase[] {
    const settings = mirrorManager.getSettings();
    const instances: ShadowLibraryProviderBase[] = [];

    for (const providerConfig of settings.providers) {
      if (!providerConfig.disabled) {
        const instance = this.getProvider(providerConfig.id);
        if (instance) {
          instances.push(instance);
        }
      }
    }

    return instances;
  }

  /**
   * Clear provider cache (for settings updates)
   */
  clearCache(): void {
    this.providers.clear();
  }

  /**
   * Refresh provider instances with updated settings
   */
  refreshProviders(): void {
    this.clearCache();
    
    const settings = mirrorManager.getSettings();
    for (const providerConfig of settings.providers) {
      if (!providerConfig.disabled) {
        this.getProvider(providerConfig.id);
      }
    }
  }
}

// Export singleton
export const providerRegistry = ProviderRegistry.getInstance();
