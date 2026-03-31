/**
 * Unified Sources Search Service
 * 
 * Combines OPDS catalogs and Shadow libraries into a single search interface
 * with rate limiting and progress tracking.
 */

import {
  UnifiedSearchQuery,
  SourceSearchResult,
  SearchProgress,
  SourceProviderType,
  SourceProvider,
  opdsCatalogToSource,
  shadowLibraryToSource,
} from '@/types/sources';
import { rateLimiter } from './rateLimiter';
import { useSettingsStore } from '@/store/settingsStore';
import { providerRegistry as shadowProviderRegistry } from '@/services/shadow-library/providerBase';
import { mirrorManager } from '@/services/shadow-library/mirrorManager';
import { initializeShadowLibrary } from '@/services/shadow-library/shadowLibraryService';

/**
 * Search result with metadata
 */
interface TimedSearchResult {
  results: SourceSearchResult[];
  sourceId: string;
  sourceName: string;
  sourceType: SourceProviderType;
  duration: number;
  error?: string;
}

/**
 * Initialize sources service
 */
export function initializeSources(): void {
  // Initialize shadow library providers
  initializeShadowLibrary();
  console.log('[Sources] Service initialized');
}

/**
 * Get all available sources (OPDS + Shadow Libraries)
 */
export function getAllSources(): SourceProvider[] {
  const settings = useSettingsStore.getState().settings;
  const sources: SourceProvider[] = [];

  // Add OPDS catalogs
  if (settings.opdsCatalogs) {
    for (const catalog of settings.opdsCatalogs) {
      if (!catalog.disabled) {
        sources.push(opdsCatalogToSource(catalog));
      }
    }
  }

  // Add Shadow libraries
  const shadowSettings = mirrorManager.getSettings();
  for (const provider of shadowSettings.providers) {
    if (!provider.disabled) {
      sources.push(shadowLibraryToSource(provider));
    }
  }

  return sources;
}

/**
 * Get enabled sources
 */
export function getEnabledSources(): SourceProvider[] {
  return getAllSources().filter(s => s.enabled);
}

/**
 * Search across all enabled sources
 */
export async function searchAllSources(
  query: UnifiedSearchQuery
): Promise<{ results: SourceSearchResult[]; progress: SearchProgress[] }> {
  const sources = getEnabledSources();
  const progress: SearchProgress[] = [];
  const allResults: SourceSearchResult[] = [];

  // Filter sources based on query
  const filteredSources = sources.filter(source => {
    if (query.excludeSourceIds?.includes(source.id)) return false;
    if (query.sourceIds && !query.sourceIds.includes(source.id)) return false;
    if (query.sourceTypes && !query.sourceTypes.includes(source.type)) return false;
    return true;
  });

  // Sort by preferred sources
  const preferences = useSettingsStore.getState().settings.sourcesPreferences;
  if (preferences?.preferredSources) {
    filteredSources.sort((a, b) => {
      const aIndex = preferences.preferredSources.indexOf(a.id);
      const bIndex = preferences.preferredSources.indexOf(b.id);
      if (aIndex === -1 && bIndex === -1) return 0;
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });
  }

  // Search each source with rate limiting
  const searchPromises = filteredSources.map(async source => {
    const startTime = Date.now();
    const progressItem: SearchProgress = {
      sourceId: source.id,
      sourceName: source.name,
      status: 'pending',
      resultCount: 0,
      startTime,
    };
    progress.push(progressItem);

    try {
      progressItem.status = 'searching';

      const results = await searchSingleSource(source, query);
      
      progressItem.status = 'completed';
      progressItem.resultCount = results.length;
      progressItem.endTime = Date.now();
      progressItem.duration = progressItem.endTime - progressItem.startTime;

      allResults.push(...results);
    } catch (error) {
      progressItem.status = 'error';
      progressItem.error = error instanceof Error ? error.message : 'Unknown error';
      progressItem.endTime = Date.now();
    }
  });

  // Execute searches with rate limiting
  await Promise.allSettled(searchPromises);

  // Sort results by relevance (preferred sources first)
  if (preferences?.preferredSources) {
    allResults.sort((a, b) => {
      const aIndex = preferences.preferredSources.indexOf(a.sourceId);
      const bIndex = preferences.preferredSources.indexOf(b.sourceId);
      if (aIndex === -1 && bIndex === -1) return 0;
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });
  }

  return { results: allResults, progress };
}

/**
 * Search a single source
 */
async function searchSingleSource(
  source: SourceProvider,
  query: UnifiedSearchQuery
): Promise<SourceSearchResult[]> {
  const timeout = query.timeout || 15000;

  // Create search function with timeout
  const searchFn = async (): Promise<SourceSearchResult[]> => {
    // Shadow library search
    if (source.type !== SourceProviderType.OPDS) {
      const provider = shadowProviderRegistry.getProvider(source.id);
      if (!provider) {
        throw new Error(`Provider not found: ${source.id}`);
      }

      const shadowQuery = {
        query: query.query,
        doi: query.doi,
        isbn: query.isbn,
        title: query.title,
        author: query.author,
        limit: query.limit,
      };

      const results = await provider.search(shadowQuery);
      
      // Convert shadow library results to unified format
      return results.map(result => ({
        ...result,
        sourceId: source.id,
        sourceName: source.name,
        sourceType: source.type,
      }));
    }

    // OPDS search (to be implemented)
    console.warn(`OPDS search not yet implemented for ${source.name}`);
    return [];
  };

  // Execute with rate limiting and timeout
  const searchId = `search-${source.id}-${Date.now()}`;
  
  try {
    return await Promise.race([
      rateLimiter.queueRequest(searchId, searchFn, source.type),
      new Promise<SourceSearchResult[]>((_, reject) => 
        setTimeout(() => reject(new Error('Search timeout')), timeout)
      ),
    ]);
  } catch (error) {
    console.error(`Search failed for ${source.name}:`, error);
    throw error;
  }
}

/**
 * Resolve DOI using preferred sources
 */
export async function resolveDOI(doi: string): Promise<SourceSearchResult | null> {
  const preferences = useSettingsStore.getState().settings.sourcesPreferences;
  const doiOrder = preferences?.doiResolutionOrder || [
    'unpaywall',
    'openaccess-button',
    'scihub',
    'annas-archive',
  ];

  for (const sourceId of doiOrder) {
    try {
      const provider = shadowProviderRegistry.getProvider(sourceId);
      if (!provider || !provider.resolveDOI) continue;

      const result = await provider.resolveDOI(doi);
      
      if (result.success && result.pdfUrl) {
        return {
          id: doi,
          sourceId: sourceId,
          sourceName: provider.getName(),
          sourceType: SourceProviderType.DOI_RESOLVER,
          title: result.metadata?.title || doi,
          authors: result.metadata?.authors || [],
          downloadUrl: result.pdfUrl,
          doi: doi,
        };
      }
    } catch (error) {
      console.warn(`DOI resolution failed via ${sourceId}:`, error);
    }
  }

  return null;
}

/**
 * Get download URL for a result
 */
export async function getDownloadUrl(
  sourceId: string,
  resultId: string
): Promise<string> {
  const provider = shadowProviderRegistry.getProvider(sourceId);
  if (!provider) {
    throw new Error(`Provider not found: ${sourceId}`);
  }

  return provider.getDownloadUrl(resultId);
}

/**
 * Get streaming URL for a result
 */
export async function getStreamingUrl(
  sourceId: string,
  resultId: string
): Promise<string | null> {
  const provider = shadowProviderRegistry.getProvider(sourceId);
  if (!provider || !provider.getStreamingUrl) {
    return null;
  }

  return provider.getStreamingUrl(resultId);
}

/**
 * Cancel ongoing searches
 */
export function cancelSearches(): void {
  rateLimiter.clearAllQueues();
}

/**
 * Get rate limiter status
 */
export function getRateLimiterStatus(): ReturnType<typeof rateLimiter.getStats> {
  return rateLimiter.getStats();
}

/**
 * Search progress listener
 */
export type SearchProgressCallback = (progress: SearchProgress[]) => void;

/**
 * Search with progress updates
 */
export async function searchWithProgress(
  query: UnifiedSearchQuery,
  onProgress?: SearchProgressCallback
): Promise<{ results: SourceSearchResult[]; progress: SearchProgress[] }> {
  const sources = getEnabledSources();
  const progress: SearchProgress[] = [];
  const allResults: SourceSearchResult[] = [];

  // Filter and sort sources
  const filteredSources = sources.filter(source => {
    if (query.excludeSourceIds?.includes(source.id)) return false;
    if (query.sourceIds && !query.sourceIds.includes(source.id)) return false;
    if (query.sourceTypes && !query.sourceTypes.includes(source.type)) return false;
    return true;
  });

  const preferences = useSettingsStore.getState().settings.sourcesPreferences;
  if (preferences?.preferredSources) {
    filteredSources.sort((a, b) => {
      const aIndex = preferences.preferredSources.indexOf(a.id);
      const bIndex = preferences.preferredSources.indexOf(b.id);
      if (aIndex === -1 && bIndex === -1) return 0;
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });
  }

  // Search each source
  const searchPromises = filteredSources.map(async source => {
    const startTime = Date.now();
    const progressItem: SearchProgress = {
      sourceId: source.id,
      sourceName: source.name,
      status: 'pending',
      resultCount: 0,
      startTime,
    };
    progress.push(progressItem);

    // Notify progress
    onProgress?.([...progress]);

    try {
      progressItem.status = 'searching';
      onProgress?.([...progress]);

      const results = await searchSingleSource(source, query);
      
      progressItem.status = 'completed';
      progressItem.resultCount = results.length;
      progressItem.endTime = Date.now();
      
      allResults.push(...results);
    } catch (error) {
      progressItem.status = 'error';
      progressItem.error = error instanceof Error ? error.message : 'Unknown error';
      progressItem.endTime = Date.now();
    }

    // Notify progress
    onProgress?.([...progress]);
  });

  await Promise.allSettled(searchPromises);

  // Sort results
  if (preferences?.preferredSources) {
    allResults.sort((a, b) => {
      const aIndex = preferences.preferredSources.indexOf(a.sourceId);
      const bIndex = preferences.preferredSources.indexOf(b.sourceId);
      if (aIndex === -1 && bIndex === -1) return 0;
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });
  }

  return { results: allResults, progress };
}
