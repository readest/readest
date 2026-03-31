/**
 * Shadow Library Service
 * 
 * Main service for interacting with shadow library providers.
 * Provides unified interface for search, DOI resolution, and downloads.
 */

import {
  ShadowLibrarySearchQuery,
  ShadowLibrarySearchResult,
  DOIResolutionResult,
  ShadowLibraryProviderType,
} from '@/types/shadow-library';
import { mirrorManager } from './mirrorManager';
import { providerRegistry } from './providerBase';
import { LibGenProvider } from '@/services/shadow-library/providers/libgen';
import { SciHubProvider } from '@/services/shadow-library/providers/scihub';
import { ZLibraryProvider } from '@/services/shadow-library/providers/zlibrary';
import { UnpaywallProvider } from '@/services/shadow-library/providers/unpaywall';

/**
 * Initialize shadow library service
 */
export function initializeShadowLibrary(): void {
  // Register provider implementations
  providerRegistry.register('libgen', LibGenProvider);
  providerRegistry.register('scihub', SciHubProvider);
  providerRegistry.register('zlibrary', ZLibraryProvider);
  providerRegistry.register('unpaywall', UnpaywallProvider);

  // Initialize mirror manager
  // Note: Settings will be loaded from persistent storage by the caller
  console.log('[ShadowLibrary] Service initialized');
}

/**
 * Search across all enabled shadow libraries
 */
export async function searchAllProviders(
  query: ShadowLibrarySearchQuery
): Promise<Map<string, ShadowLibrarySearchResult[]>> {
  const providers = providerRegistry.getAllProviders();
  const results = new Map<string, ShadowLibrarySearchResult[]>();

  await Promise.all(
    providers.map(async provider => {
      if (provider.getId() === 'scihub' || provider.getId() === 'unpaywall') {
        // Skip DOI resolvers for general search
        return;
      }

      try {
        const providerResults = await provider.search(query);
        results.set(provider.getId(), providerResults);
      } catch (error) {
        console.error(`[ShadowLibrary] ${provider.getName()} search failed:`, error);
        results.set(provider.getId(), []);
      }
    })
  );

  return results;
}

/**
 * Search specific provider
 */
export async function searchProvider(
  providerId: string,
  query: ShadowLibrarySearchQuery
): Promise<ShadowLibrarySearchResult[]> {
  const provider = providerRegistry.getProvider(providerId);
  if (!provider) {
    throw new Error(`Provider not found: ${providerId}`);
  }

  return provider.search(query);
}

/**
 * Resolve DOI using preferred providers (in order: Unpaywall → OpenAccess Button → Sci-Hub)
 */
export async function resolveDOI(doi: string): Promise<DOIResolutionResult> {
  const doiResolvers = mirrorManager.getDOIRsolvers();

  for (const resolverConfig of doiResolvers) {
    const provider = providerRegistry.getProvider(resolverConfig.id);
    if (!provider || !provider.resolveDOI) {
      continue;
    }

    try {
      console.log(`[ShadowLibrary] Trying DOI resolver: ${resolverConfig.name}`);
      const result = await provider.resolveDOI(doi);

      if (result.success) {
        console.log(`[ShadowLibrary] DOI resolved successfully via ${resolverConfig.name}`);
        return result;
      }

      console.log(`[ShadowLibrary] ${resolverConfig.name} failed: ${result.error}`);
    } catch (error) {
      console.error(`[ShadowLibrary] ${resolverConfig.name} error:`, error);
    }
  }

  return {
    success: false,
    providerId: 'none',
    fallbackAvailable: false,
    error: 'All DOI resolvers failed',
  };
}

/**
 * Get download URL for a specific result
 */
export async function getDownloadUrl(
  providerId: string,
  resultId: string
): Promise<string> {
  const provider = providerRegistry.getProvider(providerId);
  if (!provider) {
    throw new Error(`Provider not found: ${providerId}`);
  }

  return provider.getDownloadUrl(resultId);
}

/**
 * Get streaming URL for reading online (if supported)
 */
export async function getStreamingUrl(
  providerId: string,
  resultId: string
): Promise<string | null> {
  const provider = providerRegistry.getProvider(providerId);
  if (!provider || !provider.getStreamingUrl) {
    return null;
  }

  return provider.getStreamingUrl(resultId);
}

/**
 * Get all enabled providers
 */
export function getEnabledProviders(): Array<{
  id: string;
  name: string;
  type: ShadowLibraryProviderType;
  icon?: string;
  capabilities: any;
}> {
  const settings = mirrorManager.getSettings();
  return settings.providers
    .filter(p => !p.disabled)
    .map(p => ({
      id: p.id,
      name: p.name,
      type: p.type,
      icon: p.icon,
      capabilities: p.capabilities,
    }));
}

/**
 * Get providers by type
 */
export function getProvidersByType(type: ShadowLibraryProviderType): Array<{
  id: string;
  name: string;
  icon?: string;
}> {
  const providers = mirrorManager.getProvidersByType(type);
  return providers.map(p => ({
    id: p.id,
    name: p.name,
    icon: p.icon,
  }));
}

/**
 * Check health of all mirrors
 */
export async function checkAllMirrors(): Promise<void> {
  const providers = mirrorManager.getEnabledProviders();
  
  await Promise.all(
    providers.map(provider => mirrorManager.checkProviderHealth(provider))
  );
}

/**
 * Get mirror status for a provider
 */
export function getMirrorStatus(providerId: string): Array<{
  url: string;
  isActive: boolean;
  priority: number;
  responseTime?: number;
  lastChecked?: number;
}> {
  const provider = mirrorManager.getProvider(providerId);
  if (!provider) {
    return [];
  }

  return provider.mirrors.map(m => ({
    url: m.url,
    isActive: m.isActive,
    priority: m.priority,
    responseTime: m.responseTime,
    lastChecked: m.lastChecked,
  }));
}
