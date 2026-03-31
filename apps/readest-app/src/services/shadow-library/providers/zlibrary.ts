/**
 * Z-Library Provider Implementation
 * 
 * Supports search, download, and streaming (read online feature)
 */

import {
  ShadowLibraryProvider,
  ShadowLibrarySearchQuery,
  ShadowLibrarySearchResult,
} from '@/types/shadow-library';
import { ShadowLibraryProviderBase } from '../providerBase';

export class ZLibraryProvider extends ShadowLibraryProviderBase {
  constructor(provider: ShadowLibraryProvider) {
    super(provider);
  }

  /**
   * Search Z-Library
   */
  async search(query: ShadowLibrarySearchQuery): Promise<ShadowLibrarySearchResult[]> {
    const baseUrl = this.getActiveMirrorUrl();
    if (!baseUrl) {
      throw new Error('No active mirror available');
    }

    // Build search query
    const searchQuery = query.query || query.title || '';
    const endpoint = `/s/?q=${encodeURIComponent(searchQuery)}`;

    try {
      const response = await this.makeRequest(`${baseUrl}${endpoint}`);
      const doc = await this.parseHTML(response);
      
      return this.parseSearchResults(doc, baseUrl);
    } catch (error) {
      console.error('[ZLibrary] Search failed:', error);
      throw error;
    }
  }

  /**
   * Parse Z-Library search results
   */
  private parseSearchResults(doc: Document, baseUrl: string): ShadowLibrarySearchResult[] {
    const results: ShadowLibrarySearchResult[] = [];
    const items = doc.querySelectorAll('.searchItem');

    for (const item of Array.from(items)) {
      try {
        const titleEl = item.querySelector('.bookTitle');
        const authorEl = item.querySelector('.authors');
        const yearEl = item.querySelector('.bookYear');
        const coverEl = item.querySelector('.coverImg img');
        const downloadEl = item.querySelector('[data-dl-link]');
        
        const id = item.getAttribute('data-id') || '';
        const title = titleEl?.textContent?.trim() || '';
        const authors = authorEl?.textContent?.split(',').map(a => a.trim()) || [];
        const year = yearEl?.textContent?.trim();
        const coverUrl = coverEl?.getAttribute('src');
        
        if (!id || !title) continue;

        results.push({
          id,
          title,
          authors,
          year,
          coverUrl: coverUrl?.startsWith('http') ? coverUrl : `${baseUrl}${coverUrl}`,
          downloadUrl: `${baseUrl}/book/${id}`,
          streamingUrl: `${baseUrl}/reader/${id}`,  // Z-Library read feature
          mirrorIndex: this.provider.activeMirrorIndex,
          extensionData: {
            hasStreaming: true,
          },
        });
      } catch (error) {
        console.warn('[ZLibrary] Failed to parse item:', error);
      }
    }

    return results;
  }

  /**
   * Get download URL
   */
  async getDownloadUrl(resultId: string): Promise<string> {
    const baseUrl = this.getActiveMirrorUrl();
    if (!baseUrl) {
      throw new Error('No active mirror available');
    }

    // Get the actual download link from the book page
    try {
      const response = await this.makeRequest(`${baseUrl}/book/${resultId}`);
      const doc = await this.parseHTML(response);
      
      // Find download button
      const downloadLink = doc.querySelector('.downloadLink a[href*="/dl/"]')?.getAttribute('href');
      
      if (downloadLink) {
        return downloadLink.startsWith('http') ? downloadLink : `${baseUrl}${downloadLink}`;
      }
    } catch (error) {
      console.error('[ZLibrary] Failed to get download URL:', error);
    }

    // Fallback to book page
    return `${baseUrl}/book/${resultId}`;
  }

  /**
   * Get streaming URL for reading online
   */
  async getStreamingUrl(resultId: string): Promise<string | null> {
    if (!this.provider.capabilities.streaming) {
      return null;
    }

    const baseUrl = this.getActiveMirrorUrl();
    if (!baseUrl) {
      return null;
    }

    // Z-Library reader URL
    return `${baseUrl}/reader/${resultId}`;
  }

  /**
   * Search by ISBN
   */
  async searchByISBN(isbn: string): Promise<ShadowLibrarySearchResult[]> {
    return this.search({ query: `isbn:${isbn}` });
  }

  /**
   * Get book details
   */
  async getBookDetails(bookId: string): Promise<ShadowLibrarySearchResult | null> {
    const baseUrl = this.getActiveMirrorUrl();
    if (!baseUrl) {
      return null;
    }

    try {
      const response = await this.makeRequest(`${baseUrl}/book/${bookId}`);
      const doc = await this.parseHTML(response);
      
      const title = doc.querySelector('h1')?.textContent?.trim() || '';
      const author = doc.querySelector('.bookAuthor')?.textContent?.trim() || '';
      const description = doc.querySelector('.bookDescription')?.textContent?.trim() || '';
      const coverUrl = doc.querySelector('.bookCover img')?.getAttribute('src');
      const year = doc.querySelector('.bookYear')?.textContent?.trim();
      const publisher = doc.querySelector('.bookPublisher')?.textContent?.trim();
      const language = doc.querySelector('.bookLanguage')?.textContent?.trim();
      const format = doc.querySelector('.bookFormat')?.textContent?.trim();
      const size = doc.querySelector('.bookSize')?.textContent?.trim();
      const isbn = doc.querySelector('.bookIsbn')?.textContent?.trim();

      return {
        id: bookId,
        title,
        authors: author ? [author] : [],
        description,
        coverUrl: coverUrl?.startsWith('http') ? coverUrl : `${baseUrl}${coverUrl}`,
        year,
        publisher,
        language,
        format,
        size,
        isbn,
        downloadUrl: `${baseUrl}/book/${bookId}`,
        streamingUrl: `${baseUrl}/reader/${bookId}`,
        extensionData: {
          hasStreaming: true,
        },
      };
    } catch (error) {
      console.error('[ZLibrary] Failed to get book details:', error);
      return null;
    }
  }
}
