/**
 * Source Icons
 * Professional React Icons for each source type
 */

import {
  IoBook,
  IoGlobe,
  IoDocumentText,
  IoLibrary,
  IoSchool,
  IoNewspaper,
  IoFlask,
  IoCodeSlash,
  IoInfinite,
  IoLockOpen,
  IoSearch,
  IoCloudDownload,
} from 'react-icons/io5';
import {
  SiArxiv,
  SiPubmed,
  SiResearchgate,
  SiAcademia,
  SiZotero,
  SiMendeley,
  SiOpenaccess,
} from 'react-icons/si';
import type { ComponentType } from 'react';
import { SourceProviderType } from '@/types/sources';

/**
 * Default icons for different source types
 */
export const SOURCE_TYPE_ICONS: Record<SourceProviderType, ComponentType<{ className?: string }>> = {
  [SourceProviderType.OPDS]: IoLibrary,
  [SourceProviderType.SHADOW_LIBRARY]: IoBook,
  [SourceProviderType.DOI_RESOLVER]: IoDocumentText,
  [SourceProviderType.OPEN_ACCESS]: IoLockOpen,
  [SourceProviderType.AGGREGATOR]: IoInfinite,
};

/**
 * Specific icons for known providers
 */
export const PROVIDER_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  // Shadow libraries
  'libgen': IoBook,
  'zlibrary': IoBook,
  'annas-archive': IoInfinite,
  
  // DOI resolvers
  'scihub': IoFlask,
  'unpaywall': IoLockOpen,
  'openaccess-button': IoLockOpen,
  
  // Academic sources
  'arxiv': SiArxiv,
  'pubmed': SiPubmed,
  'researchgate': SiResearchgate,
  'academia': SiAcademia,
  
  // Reference managers
  'zotero': SiZotero,
  'mendeley': SiMendeley,
  
  // Open access
  'doaj': SiOpenaccess,
  'core': IoDocumentText,
  
  // OPDS catalogs
  'gutenberg': IoBook,
  'standardebooks': IoCodeSlash,
  'manybooks': IoBook,
};

/**
 * Get icon for a provider
 */
export function getProviderIcon(providerId: string, sourceType: SourceProviderType) {
  return PROVIDER_ICONS[providerId] || SOURCE_TYPE_ICONS[sourceType];
}

/**
 * Get color for source type
 */
export function getSourceTypeColor(sourceType: SourceProviderType): string {
  switch (sourceType) {
    case SourceProviderType.OPDS:
      return 'text-blue-500';
    case SourceProviderType.SHADOW_LIBRARY:
      return 'text-purple-500';
    case SourceProviderType.DOI_RESOLVER:
      return 'text-green-500';
    case SourceProviderType.OPEN_ACCESS:
      return 'text-emerald-500';
    case SourceProviderType.AGGREGATOR:
      return 'text-orange-500';
    default:
      return 'text-gray-500';
  }
}

/**
 * Get badge color for source type
 */
export function getSourceTypeBadgeColor(sourceType: SourceProviderType): string {
  switch (sourceType) {
    case SourceProviderType.OPDS:
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300';
    case SourceProviderType.SHADOW_LIBRARY:
      return 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300';
    case SourceProviderType.DOI_RESOLVER:
      return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
    case SourceProviderType.OPEN_ACCESS:
      return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300';
    case SourceProviderType.AGGREGATOR:
      return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300';
    default:
      return 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300';
  }
}
