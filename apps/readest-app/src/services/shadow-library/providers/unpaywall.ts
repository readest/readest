/**
 * Unpaywall Provider Implementation
 * 
 * Legal open access PDF discovery via DOI
 */

import {
  ShadowLibraryProvider,
  ShadowLibrarySearchQuery,
  ShadowLibrarySearchResult,
  DOIResolutionResult,
} from '@/types/shadow-library';
import { ShadowLibraryProviderBase } from '../providerBase';
import { mirrorManager } from '../mirrorManager';

export class UnpaywallProvider extends ShadowLibraryProviderBase {
  constructor(provider: ShadowLibraryProvider) {
    super(provider);
  }

  /**
   * Unpaywall only supports DOI lookup, not general search
   */
  async search(query: ShadowLibrarySearchQuery): Promise<ShadowLibrarySearchResult[]> {
    if (query.doi) {
      const result = await this.resolveDOI(query.doi);
      if (result.success && result.pdfUrl) {
        return [
          {
            id: query.doi,
            title: result.metadata?.title || query.doi,
            authors: result.metadata?.authors || [],
            downloadUrl: result.pdfUrl,
            doi: query.doi,
          },
        ];
      }
    }
    return [];
  }

  /**
   * Resolve DOI to open access PDF
   */
  async resolveDOI(doi: string): Promise<DOIResolutionResult> {
    const apiKey = this.getSetting<string>('apiKey');
    
    if (!apiKey) {
      return {
        success: false,
        providerId: this.provider.id,
        fallbackAvailable: mirrorManager.getDOIRsolvers().length > 1,
        error: 'API key required',
      };
    }

    const baseUrl = this.getActiveMirrorUrl();
    if (!baseUrl) {
      return {
        success: false,
        providerId: this.provider.id,
        fallbackAvailable: mirrorManager.getDOIRsolvers().length > 1,
        error: 'No active mirror available',
      };
    }

    try {
      // Unpaywall API: https://api.unpaywall.org/v2/{doi}?email={email}
      const endpoint = `${baseUrl}/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(apiKey)}`;
      const response = await this.makeRequest(endpoint);
      const data = await this.parseJSON<UnpaywallResponse>(response);

      if (!data || data.unpaywall_version === 2) {
        return {
          success: false,
          providerId: this.provider.id,
          fallbackAvailable: mirrorManager.getDOIRsolvers().length > 1,
          error: 'DOI not found',
        };
      }

      if (!data.is_oa || !data.best_oa_location) {
        return {
          success: false,
          providerId: this.provider.id,
          fallbackAvailable: mirrorManager.getDOIRsolvers().length > 1,
          error: 'No open access version available',
        };
      }

      const bestLocation = data.best_oa_location;
      
      return {
        success: true,
        pdfUrl: bestLocation.url,
        providerId: this.provider.id,
        metadata: {
          title: data.title,
          authors: data.author?.split(',').map(a => a.trim()) || [],
          journal: data.journal_name,
          publisher: data.publisher,
          publishedDate: data.published_date,
        },
        fallbackAvailable: false,
      };
    } catch (error) {
      console.error('[Unpaywall] DOI resolution failed:', error);
      
      return {
        success: false,
        providerId: this.provider.id,
        fallbackAvailable: mirrorManager.getDOIRsolvers().length > 1,
        error: error instanceof Error ? error.message : 'Resolution failed',
      };
    }
  }

  /**
   * Get download URL
   */
  async getDownloadUrl(doi: string): Promise<string> {
    const result = await this.resolveDOI(doi);
    if (result.success && result.pdfUrl) {
      return result.pdfUrl;
    }
    throw new Error(result.error || 'Failed to get download URL');
  }

  /**
   * Check if DOI has open access version (without downloading)
   */
  async checkOA(doi: string): Promise<{ isOA: boolean; url?: string }> {
    const apiKey = this.getSetting<string>('apiKey');
    if (!apiKey) {
      return { isOA: false };
    }

    const baseUrl = this.getActiveMirrorUrl();
    if (!baseUrl) {
      return { isOA: false };
    }

    try {
      const endpoint = `${baseUrl}/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(apiKey)}`;
      const response = await this.makeRequest(endpoint);
      const data = await this.parseJSON<UnpaywallResponse>(response);

      return {
        isOA: data.is_oa || false,
        url: data.best_oa_location?.url,
      };
    } catch (error) {
      console.error('[Unpaywall] OA check failed:', error);
      return { isOA: false };
    }
  }
}

/**
 * Unpaywall API response type
 */
interface UnpaywallResponse {
  doi: string;
  doi_url: string;
  title: string;
  genre: string;
  is_paratext: boolean;
  is_oa: boolean;
  is_accepted: boolean;
  is_published: boolean;
  journal_name: string;
  journal_issns: string;
  journal_issn_l: string;
  journal_is_oa: boolean;
  journal_is_in_doaj: boolean;
  publisher: string;
  updated_date: string;
  published_date: string;
  year: number;
  author: string;
  author_affiliations: string[];
  best_oa_location: {
    updated_date: string;
    url: string;
    url_for_pdf: string;
    url_for_landing_page: string;
    evidence: string;
    license: string;
    version: string;
    host_type: string;
    repository_institution: string;
    oa_date: string;
  } | null;
  oa_locations: Array<{
    updated_date: string;
    url: string;
    url_for_pdf: string;
    url_for_landing_page: string;
    evidence: string;
    license: string;
    version: string;
    host_type: string;
    repository_institution: string;
    oa_date: string;
  }>;
  data_standard: number;
  unpaywall_version: number;
}
