/**
 * Sci-Hub Provider Implementation
 * 
 * DOI-based academic paper resolver with automatic mirror fallback
 */

import {
  ShadowLibraryProvider,
  ShadowLibrarySearchQuery,
  ShadowLibrarySearchResult,
  DOIResolutionResult,
} from '@/types/shadow-library';
import { ShadowLibraryProviderBase } from '../providerBase';
import { mirrorManager } from '../mirrorManager';

export class SciHubProvider extends ShadowLibraryProviderBase {
  constructor(provider: ShadowLibraryProvider) {
    super(provider);
  }

  /**
   * Sci-Hub doesn't support general search, only DOI resolution
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
   * Resolve DOI to PDF
   * @param retryDepth - Internal counter to bound mirror-switch retries.
   */
  async resolveDOI(doi: string, retryDepth = 0): Promise<DOIResolutionResult> {
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
      // Sci-Hub URL pattern: /science.php?doi=DOI or /resolve.php?doi=DOI
      const endpoint = `/science.php?doi=${encodeURIComponent(doi)}`;
      const response = await this.makeRequest(`${baseUrl}${endpoint}`, {
        redirect: 'follow',
      });

      // Check if we got redirected to PDF
      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/pdf')) {
        return {
          success: true,
          pdfUrl: response.url,
          providerId: this.provider.id,
          mirrorIndex: this.provider.activeMirrorIndex,
          fallbackAvailable: false,
        };
      }

      // Parse HTML to find PDF link
      const doc = await this.parseHTML(response);
      
      // Look for PDF download button/link
      const pdfLink =
        doc.querySelector('a[onclick*="downloadPdf"]')?.getAttribute('href') ||
        doc.querySelector('iframe#pdf')?.getAttribute('src') ||
        doc.querySelector('a[href*=".pdf"]')?.getAttribute('href');

      if (pdfLink) {
        const pdfUrl = pdfLink.startsWith('http') ? pdfLink : `${baseUrl}${pdfLink}`;
        return {
          success: true,
          pdfUrl,
          providerId: this.provider.id,
          mirrorIndex: this.provider.activeMirrorIndex,
          fallbackAvailable: false,
        };
      }

      // Extract metadata if available
      const title = doc.querySelector('.citation_title')?.textContent?.trim();
      const authors = Array.from(doc.querySelectorAll('.citation_author') || [])
        .map(el => el.textContent?.trim())
        .filter(Boolean) as string[];

      return {
        success: false,
        providerId: this.provider.id,
        fallbackAvailable: mirrorManager.getDOIRsolvers().length > 1,
        error: 'PDF not found',
        metadata: title ? { title, authors } : undefined,
      };
    } catch (error) {
      console.error('[SciHub] DOI resolution failed:', error);
      
      // Try next mirror, capped at mirror count to prevent infinite recursion
      const hasMoreMirrors = await this.switchMirror();
      if (hasMoreMirrors && retryDepth < this.provider.mirrors.length) {
        return this.resolveDOI(doi, retryDepth + 1);
      }

      return {
        success: false,
        providerId: this.provider.id,
        fallbackAvailable: mirrorManager.getDOIRsolvers().length > 1,
        error: error instanceof Error ? error.message : 'Resolution failed',
      };
    }
  }

  /**
   * Get download URL (alias for resolveDOI)
   */
  async getDownloadUrl(doi: string): Promise<string> {
    const result = await this.resolveDOI(doi);
    if (result.success && result.pdfUrl) {
      return result.pdfUrl;
    }
    throw new Error(result.error || 'Failed to get download URL');
  }

  /**
   * Batch resolve multiple DOIs
   */
  async resolveDOIs(dois: string[]): Promise<Map<string, DOIResolutionResult>> {
    const results = new Map<string, DOIResolutionResult>();

    for (const doi of dois) {
      try {
        const result = await this.resolveDOI(doi);
        results.set(doi, result);
        
        // Rate limiting - be respectful
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        results.set(doi, {
          success: false,
          providerId: this.provider.id,
          fallbackAvailable: true,
          error: error instanceof Error ? error.message : 'Resolution failed',
        });
      }
    }

    return results;
  }
}
