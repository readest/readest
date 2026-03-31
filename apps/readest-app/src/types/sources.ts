/**
 * Unified Sources Types
 * 
 * Combines OPDS catalogs and Shadow libraries into a single search interface
 */

import { ShadowLibraryProviderType } from './shadow-library';
import { OPDSCatalog } from './opds';

/**
 * Unified source provider
 */
export interface SourceProvider {
  id: string;
  name: string;
  type: SourceProviderType;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  enabled: boolean;
  requiresAuth: boolean;
  supportsSearch: boolean;
  supportsDOI: boolean;
  supportsISBN: boolean;
  supportsStreaming: boolean;
  mirrorCount?: number;
  activeMirrorUrl?: string;
}

/**
 * Source provider types
 */
export enum SourceProviderType {
  OPDS = 'opds',
  SHADOW_LIBRARY = 'shadow_library',
  DOI_RESOLVER = 'doi_resolver',
  OPEN_ACCESS = 'open_access',
  AGGREGATOR = 'aggregator',
}

/**
 * Unified search result
 */
export interface SourceSearchResult {
  id: string;
  sourceId: string;
  sourceName: string;
  sourceType: SourceProviderType;
  title: string;
  authors?: string[];
  publisher?: string;
  year?: string;
  language?: string;
  format?: string;
  size?: string;
  doi?: string;
  isbn?: string;
  
  // URLs
  downloadUrl?: string;
  streamingUrl?: string;
  detailUrl?: string;
  
  // Metadata
  coverUrl?: string;
  description?: string;
  subjects?: string[];
  
  // Source-specific data (generic catch-all)
  sourceData?: Record<string, unknown>;
  // Provider extension data (e.g. md5, mirrors, isbn for LibGen)
  extensionData?: Record<string, string | number | boolean | string[]>;
}

/**
 * Search query for unified sources
 */
export interface UnifiedSearchQuery {
  query?: string;
  doi?: string;
  isbn?: string;
  title?: string;
  author?: string;
  
  // Filters
  sourceTypes?: SourceProviderType[];
  sourceIds?: string[];
  excludeSourceIds?: string[];
  
  // Options
  limit?: number;
  timeout?: number;  // Per-source timeout in ms
  includeDisabled?: boolean;
}

/**
 * Search progress
 */
export interface SearchProgress {
  sourceId: string;
  sourceName: string;
  status: 'pending' | 'searching' | 'completed' | 'error';
  resultCount: number;
  error?: string;
  startTime?: number;
  endTime?: number;
}

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  requestsPerSecond: number;
  requestsPerMinute: number;
  requestsPerHour: number;
  concurrentRequests: number;
  timeoutMs: number;
  retryDelayMs: number;
  maxRetries: number;
}

/**
 * Default rate limits (conservative)
 */
export const DEFAULT_RATE_LIMITS: Record<SourceProviderType, RateLimitConfig> = {
  [SourceProviderType.OPDS]: {
    requestsPerSecond: 2,
    requestsPerMinute: 30,
    requestsPerHour: 500,
    concurrentRequests: 2,
    timeoutMs: 10000,
    retryDelayMs: 1000,
    maxRetries: 2,
  },
  [SourceProviderType.SHADOW_LIBRARY]: {
    requestsPerSecond: 1,
    requestsPerMinute: 20,
    requestsPerHour: 200,
    concurrentRequests: 1,
    timeoutMs: 30000,  // Increased to 30 seconds for slow mirrors
    retryDelayMs: 2000,
    maxRetries: 3,
  },
  [SourceProviderType.DOI_RESOLVER]: {
    requestsPerSecond: 2,
    requestsPerMinute: 60,
    requestsPerHour: 1000,
    concurrentRequests: 3,
    timeoutMs: 20000,
    retryDelayMs: 1000,
    maxRetries: 2,
  },
  [SourceProviderType.OPEN_ACCESS]: {
    requestsPerSecond: 5,
    requestsPerMinute: 100,
    requestsPerHour: 2000,
    concurrentRequests: 5,
    timeoutMs: 10000,
    retryDelayMs: 500,
    maxRetries: 3,
  },
  [SourceProviderType.AGGREGATOR]: {
    requestsPerSecond: 1,
    requestsPerMinute: 15,
    requestsPerHour: 150,
    concurrentRequests: 1,
    timeoutMs: 20000,
    retryDelayMs: 2000,
    maxRetries: 2,
  },
};

/**
 * User preferences for sources
 */
export interface SourcesPreferences {
  // Search preferences
  defaultSources: string[];  // Source IDs to search by default
  excludedSources: string[]; // Source IDs to always exclude
  preferredSources: string[]; // Source IDs to prioritize (search first)
  
  // Rate limiting
  customRateLimits: Partial<Record<SourceProviderType, Partial<RateLimitConfig>>>;
  respectRateLimits: boolean;
  
  // Search behavior
  autoSearchAllSources: boolean;  // Search all enabled sources automatically
  showAllResults: boolean;        // Show all results or just first page
  resultsPerPage: number;
  
  // Download preferences
  preferOpenAccess: boolean;      // Try open access sources first
  preferStreaming: boolean;       // Prefer streaming over download
  downloadLocation?: string;      // Custom download folder
  autoDownload: boolean;          // Auto-download on select
  
  // DOI resolution
  doiResolutionOrder: string[];   // Priority order for DOI resolvers
}

/**
 * Default preferences
 */
export const DEFAULT_SOURCES_PREFERENCES: SourcesPreferences = {
  defaultSources: [],
  excludedSources: [],
  preferredSources: ['unpaywall', 'openaccess-button'], // Legal sources first
  
  customRateLimits: {},
  respectRateLimits: true,
  
  autoSearchAllSources: true,
  showAllResults: true,
  resultsPerPage: 50,
  
  preferOpenAccess: true,
  preferStreaming: false,
  autoDownload: false,
  
  doiResolutionOrder: ['unpaywall', 'openaccess-button', 'scihub', 'annas-archive'],
};

/**
 * Convert OPDS catalog to source provider
 */
export function opdsCatalogToSource(catalog: OPDSCatalog): SourceProvider {
  return {
    id: `opds-${catalog.id}`,
    name: catalog.name,
    type: SourceProviderType.OPDS,
    description: catalog.description,
    enabled: true,
    requiresAuth: !!(catalog.username || catalog.password),
    supportsSearch: true,
    supportsDOI: false,
    supportsISBN: false,
    supportsStreaming: false,
  };
}

/**
 * Convert shadow library provider to source provider
 */
export function shadowLibraryToSource(provider: any): SourceProvider {
  return {
    id: provider.id,
    name: provider.name,
    type: mapShadowLibraryType(provider.type),
    description: provider.description,
    enabled: !provider.disabled,
    requiresAuth: provider.capabilities.requiresAuth,
    supportsSearch: provider.capabilities.search,
    supportsDOI: provider.capabilities.doiLookup,
    supportsISBN: provider.capabilities.isbnLookup,
    supportsStreaming: provider.capabilities.streaming,
    mirrorCount: provider.mirrors?.length,
    activeMirrorUrl: provider.mirrors?.[provider.activeMirrorIndex]?.url,
  };
}

/**
 * Map shadow library type to source type
 */
function mapShadowLibraryType(type: ShadowLibraryProviderType): SourceProviderType {
  switch (type) {
    case ShadowLibraryProviderType.SHADOW_LIBRARY:
      return SourceProviderType.SHADOW_LIBRARY;
    case ShadowLibraryProviderType.DOI_RESOLVER:
      return SourceProviderType.DOI_RESOLVER;
    case ShadowLibraryProviderType.OPEN_ACCESS:
      return SourceProviderType.OPEN_ACCESS;
    case ShadowLibraryProviderType.AGGREGATOR:
      return SourceProviderType.AGGREGATOR;
    default:
      return SourceProviderType.SHADOW_LIBRARY;
  }
}
