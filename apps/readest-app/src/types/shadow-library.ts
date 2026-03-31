/**
 * Shadow Library and DOI Resolver Types
 * 
 * Supports:
 * - Shadow libraries (LibGen, Z-Library, Anna's Archive, etc.)
 * - DOI resolvers (Sci-Hub, Unpaywall, OpenAccess Button, etc.)
 * - Mirror/domain rotation with health checking
 * - Extensible provider architecture
 */

/**
 * Provider types for categorization
 */
export enum ShadowLibraryProviderType {
  SHADOW_LIBRARY = 'shadow_library',  // LibGen, Z-Library, Anna's Archive
  DOI_RESOLVER = 'doi_resolver',      // Sci-Hub, Unpaywall
  OPEN_ACCESS = 'open_access',        // OpenAccess Button, CORE
  AGGREGATOR = 'aggregator',          // Anna's Archive (multi-source)
}

/**
 * Capability flags for what a provider supports
 */
export interface ShadowLibraryCapabilities {
  search: boolean;           // Can search by query
  doiLookup: boolean;        // Can resolve DOI to PDF
  isbnLookup: boolean;       // Can lookup by ISBN
  titleLookup: boolean;      // Can lookup by title
  batchDownload: boolean;    // Supports batch downloads
  streaming: boolean;        // Can stream/read online (e.g., Z-Library read feature)
  requiresAuth: boolean;     // Requires authentication
  supportsMirrors: boolean;  // Has multiple mirror domains
}

/**
 * Mirror domain with health status
 */
export interface MirrorDomain {
  url: string;
  name?: string;             // Friendly name (e.g., "Primary", "Backup 1")
  priority: number;          // Lower = higher priority (0 is first choice)
  isActive: boolean;         // Currently active/working
  lastChecked?: number;      // Timestamp of last health check
  lastSuccess?: number;      // Timestamp of last successful request
  responseTime?: number;     // Last measured response time (ms)
  failureCount: number;      // Consecutive failures
  reason?: string;           // Reason for deactivation if failed
}

/**
 * Base configuration for any shadow library provider
 */
export interface ShadowLibraryProvider {
  id: string;
  name: string;
  type: ShadowLibraryProviderType;
  description?: string;
  icon?: string;             // Emoji or icon identifier
  
  // Mirror management
  mirrors: MirrorDomain[];
  activeMirrorIndex: number; // Index of currently active mirror
  
  // Authentication (optional)
  username?: string;
  password?: string;
  apiKey?: string;
  
  // Capabilities
  capabilities: ShadowLibraryCapabilities;
  
  // Provider-specific settings (flexible key-value)
  settings: Record<string, string | boolean | number>;
  
  // Metadata
  disabled?: boolean;        // User-disabled
  isBuiltIn?: boolean;       // Built-in provider (vs user-added)
  addedAt?: number;          // Timestamp when added
}

/**
 * Search query parameters
 */
export interface ShadowLibrarySearchQuery {
  query?: string;            // Free text search
  doi?: string;              // DOI lookup
  isbn?: string;             // ISBN lookup
  title?: string;            // Title search
  author?: string;           // Author search
  limit?: number;            // Max results
  page?: number;             // Page number
}

/**
 * Search result item
 */
export interface ShadowLibrarySearchResult {
  id: string;
  title: string;
  authors?: string[];
  publisher?: string;
  year?: string;
  language?: string;
  format?: string;           // PDF, EPUB, etc.
  size?: string;             // File size (human readable)
  doi?: string;
  isbn?: string;
  
  // Download information
  downloadUrl?: string;
  streamingUrl?: string;     // For providers with read feature
  mirrorIndex?: number;      // Which mirror this is from
  
  // Metadata
  coverUrl?: string;
  description?: string;
  subjects?: string[];
  
  // Provider-specific extension data
  extensionData?: Record<string, string | number | boolean | string[]>;
}

/**
 * DOI resolution result
 */
export interface DOIResolutionResult {
  success: boolean;
  pdfUrl?: string;
  providerId: string;
  mirrorIndex?: number;
  metadata?: {
    title?: string;
    authors?: string[];
    journal?: string;
    publisher?: string;
    publishedDate?: string;
  };
  error?: string;
  fallbackAvailable: boolean; // Other providers might have it
}

/**
 * Download progress
 */
export interface DownloadProgress {
  fileId: string;
  totalBytes: number;
  downloadedBytes: number;
  progress: number;          // 0-100
  status: 'pending' | 'downloading' | 'completed' | 'error';
  error?: string;
}

/**
 * Provider interface that all shadow libraries must implement
 */
export interface IShadowLibraryProvider {
  /**
   * Get current active mirror URL
   */
  getActiveMirror(): MirrorDomain | null;
  
  /**
   * Switch to next available mirror
   */
  switchMirror(): Promise<boolean>;
  
  /**
   * Check health of all mirrors
   */
  checkMirrorHealth(): Promise<MirrorDomain[]>;
  
  /**
   * Search the library
   */
  search(query: ShadowLibrarySearchQuery): Promise<ShadowLibrarySearchResult[]>;
  
  /**
   * Get download URL for a specific item
   */
  getDownloadUrl(resultId: string): Promise<string>;
  
  /**
   * Get streaming URL for reading online (if supported)
   */
  getStreamingUrl?(resultId: string): Promise<string | null>;
  
  /**
   * Resolve DOI to PDF
   */
  resolveDOI?(doi: string): Promise<DOIResolutionResult>;
  
  /**
   * Validate provider configuration
   */
  validate(): Promise<{ valid: boolean; error?: string }>;
}

/**
 * Built-in provider definitions
 */
export const BUILTIN_SHADOW_LIBRARIES: ShadowLibraryProvider[] = [
  // Shadow Libraries
  {
    id: 'libgen',
    name: 'Library Genesis',
    type: ShadowLibraryProviderType.SHADOW_LIBRARY,
    description: 'Large collection of academic papers and books',
    icon: '📚',
    mirrors: [
      { url: 'http://libgen.li', priority: 0, isActive: true, failureCount: 0 },
      { url: 'http://libgen.is', priority: 1, isActive: true, failureCount: 0 },
      { url: 'http://libgen.rs', priority: 2, isActive: true, failureCount: 0 },
      { url: 'http://libgen.st', priority: 3, isActive: true, failureCount: 0 },
    ],
    activeMirrorIndex: 0,
    capabilities: {
      search: true,
      doiLookup: false,
      isbnLookup: true,
      titleLookup: true,
      batchDownload: false,
      streaming: false,
      requiresAuth: false,
      supportsMirrors: true,
    },
    settings: {},
    isBuiltIn: true,
  },
  {
    id: 'zlibrary',
    name: 'Z-Library',
    type: ShadowLibraryProviderType.SHADOW_LIBRARY,
    description: 'Extensive ebook collection with reading feature',
    icon: '📖',
    mirrors: [
      { url: 'https://zlibrary.se', priority: 0, isActive: true, failureCount: 0 },
      { url: 'https://zlibrary.to', priority: 1, isActive: true, failureCount: 0 },
      { url: 'https://zlibrary.global', priority: 2, isActive: true, failureCount: 0 },
      { url: 'https://zlibrary.dedicated.io', priority: 3, isActive: true, failureCount: 0 },
      { url: 'https://singlelogin.re', priority: 4, isActive: true, failureCount: 0 },
    ],
    activeMirrorIndex: 0,
    capabilities: {
      search: true,
      doiLookup: false,
      isbnLookup: true,
      titleLookup: true,
      batchDownload: false,
      streaming: true,  // Z-Library has read feature
      requiresAuth: true,
      supportsMirrors: true,
    },
    settings: {},
    isBuiltIn: true,
  },
  {
    id: 'annas-archive',
    name: "Anna's Archive",
    type: ShadowLibraryProviderType.AGGREGATOR,
    description: 'Meta-search engine aggregating multiple sources',
    icon: '🏛️',
    mirrors: [
      { url: 'https://annas-archive.org', priority: 0, isActive: true, failureCount: 0 },
      { url: 'https://annas-archive.se', priority: 1, isActive: true, failureCount: 0 },
      { url: 'https://annas-archive.li', priority: 2, isActive: true, failureCount: 0 },
    ],
    activeMirrorIndex: 0,
    capabilities: {
      search: true,
      doiLookup: true,
      isbnLookup: true,
      titleLookup: true,
      batchDownload: false,
      streaming: false,
      requiresAuth: false,
      supportsMirrors: true,
    },
    settings: {},
    isBuiltIn: true,
  },
  
  // DOI Resolvers
  {
    id: 'scihub',
    name: 'Sci-Hub',
    type: ShadowLibraryProviderType.DOI_RESOLVER,
    description: 'DOI-based academic paper resolver',
    icon: '🔬',
    mirrors: [
      { url: 'https://sci-hub.se', priority: 0, isActive: true, failureCount: 0 },
      { url: 'https://sci-hub.st', priority: 1, isActive: true, failureCount: 0 },
      { url: 'https://sci-hub.ru', priority: 2, isActive: true, failureCount: 0 },
      { url: 'https://sci-hub.cat', priority: 3, isActive: true, failureCount: 0 },
    ],
    activeMirrorIndex: 0,
    capabilities: {
      search: false,
      doiLookup: true,
      isbnLookup: false,
      titleLookup: false,
      batchDownload: false,
      streaming: false,
      requiresAuth: false,
      supportsMirrors: true,
    },
    settings: {},
    isBuiltIn: true,
  },
  {
    id: 'unpaywall',
    name: 'Unpaywall',
    type: ShadowLibraryProviderType.OPEN_ACCESS,
    description: 'Legal open access PDF finder',
    icon: '🔓',
    mirrors: [
      { url: 'https://api.unpaywall.org', priority: 0, isActive: true, failureCount: 0, name: 'API' },
    ],
    activeMirrorIndex: 0,
    capabilities: {
      search: false,
      doiLookup: true,
      isbnLookup: false,
      titleLookup: false,
      batchDownload: false,
      streaming: false,
      requiresAuth: true,  // Requires API key
      supportsMirrors: false,
    },
    settings: { apiKey: '' },
    isBuiltIn: true,
  },
  {
    id: 'openaccess-button',
    name: 'OpenAccess Button',
    type: ShadowLibraryProviderType.OPEN_ACCESS,
    description: 'Find open access versions of papers',
    icon: '🔍',
    mirrors: [
      { url: 'https://api.openaccessbutton.org', priority: 0, isActive: true, failureCount: 0, name: 'API' },
    ],
    activeMirrorIndex: 0,
    capabilities: {
      search: true,
      doiLookup: true,
      isbnLookup: false,
      titleLookup: true,
      batchDownload: false,
      streaming: false,
      requiresAuth: false,
      supportsMirrors: false,
    },
    settings: {},
    isBuiltIn: true,
  },
];

/**
 * User settings for shadow libraries
 */
export interface ShadowLibrarySettings {
  providers: ShadowLibraryProvider[];
  autoSwitchMirror: boolean;     // Auto-switch on failure
  maxMirrorFailures: number;     // Failures before marking inactive
  mirrorCheckInterval: number;   // Health check interval (ms)
  preferOpenAccess: boolean;     // Try open access first
  doiResolutionOrder: string[];  // Provider ID order for DOI resolution
}

/**
 * Default settings
 */
export const DEFAULT_SHADOW_LIBRARY_SETTINGS: ShadowLibrarySettings = {
  providers: [...BUILTIN_SHADOW_LIBRARIES],
  autoSwitchMirror: true,
  maxMirrorFailures: 3,
  mirrorCheckInterval: 300000,  // 5 minutes
  preferOpenAccess: true,
  doiResolutionOrder: ['unpaywall', 'openaccess-button', 'scihub', 'annas-archive'],
};
