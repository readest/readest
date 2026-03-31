/**
 * Library Genesis Provider Implementation
 * 
 * Searches LibGen using their web API and parses HTML results.
 * Supports search by title, author, ISBN, and series.
 */

import {
  ShadowLibraryProvider,
  ShadowLibrarySearchQuery,
  ShadowLibrarySearchResult,
} from '@/types/shadow-library';
import { ShadowLibraryProviderBase } from '../providerBase';

/**
 * LibGen search result from HTML parsing
 */
interface LibGenBook {
  id: string;
  md5: string;
  title: string;
  authors: string[];
  publisher: string;
  year: string;
  language: string;
  pages: string;
  size: string;
  extension: string;
  mirrors: string[];
  coverUrl?: string;
  series?: string;
  isbn?: string;
}

export class LibGenProvider extends ShadowLibraryProviderBase {
  constructor(provider: ShadowLibraryProvider) {
    super(provider);
  }

  /**
   * Search LibGen by query
   * Note: libgen.li uses a single search endpoint at /index.php
   */
  async search(query: ShadowLibrarySearchQuery): Promise<ShadowLibrarySearchResult[]> {
    const baseUrl = this.getActiveMirrorUrl();
    if (!baseUrl) {
      throw new Error('No active mirror available');
    }

    // Determine search type and query
    let searchQuery = '';
    let column = 'title'; // Default column

    if (query.doi) {
      searchQuery = query.doi;
    } else if (query.isbn) {
      searchQuery = query.isbn;
      column = 'identifier';
    } else if (query.author) {
      searchQuery = query.author;
      column = 'author';
    } else if (query.title) {
      searchQuery = query.title;
      column = 'title';
    } else if (query.query) {
      searchQuery = query.query;
      column = 'title';
    }

    if (!searchQuery) {
      return [];
    }

    // libgen.li uses /index.php for all searches
    if (baseUrl.includes('libgen.li')) {
      return this.searchLibgenLi(baseUrl, searchQuery, column);
    } else {
      // Standard libgen format (.is, .rs, .st, etc.)
      return this.searchStandard(baseUrl, searchQuery, column);
    }
  }

  /**
   * Search libgen.li specifically (with minimal retry for unstable server)
   * Uses the correct libgen.li URL format with columns[], objects[], topics[]
   * Searches all topics but filters out comics at the extension level
   * Uses res=25 (libgen default) for better readability
   */
  private async searchLibgenLi(
    baseUrl: string,
    searchQuery: string,
    column: string
  ): Promise<ShadowLibrarySearchResult[]> {
    // Correct libgen.li format - search all fields and ALL topics
    // columns[]: t=title, a=author, s=series, y=year, p=publisher, i=isbn
    // objects[]: f=files, e=editions, s=series, a=authors, p=publishers, w=works
    // topics[]: ALL (l=libgen, f=fiction, a=articles, m=magazines, s=standards) - excludes comics
    // res=25 is libgen.li default for better readability
    const baseParams = `req=${encodeURIComponent(searchQuery)}&columns[]=t&columns[]=a&columns[]=s&columns[]=y&columns[]=p&columns[]=i&objects[]=f&objects[]=e&objects[]=s&objects[]=a&objects[]=p&objects[]=w&topics[]=l&topics[]=f&topics[]=a&topics[]=m&topics[]=s&res=25&filesuns=all`;
    
    const allResults: ShadowLibrarySearchResult[] = [];
    const maxPages = 8; // Fetch up to 8 pages (200 results max with res=25)
    const maxRetries = 0; // No retries to avoid timeout

    for (let page = 1; page <= maxPages; page++) {
      const endpoint = `/index.php?${baseParams}&page=${page}`;
      let lastError: Error | null = null;
      let pageAttempted = false;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          pageAttempted = true;

          const response = await this.makeRequest(`${baseUrl}${endpoint}`);
          const html = await response.text();

          console.log(`[LibGen] Page ${page} response received, HTML length:`, html.length);

          const results = this.parseSearchResults(html, baseUrl, 'libgen.li');
          console.log(`[LibGen] Page ${page} parsed results:`, results.length);

          allResults.push(...results);

          // Stop if we've fetched enough results
          if (allResults.length >= 150) {
            console.log(`[LibGen] Got ${allResults.length} results, stopping pagination`);
            return allResults;
          }

          // Stop if page returned no results (only trust this after the first page,
          // since page 1 returning empty means the query itself has no hits)
          if (results.length === 0) {
            console.log(`[LibGen] Page ${page} returned no results, stopping pagination`);
            return allResults;
          }

          break; // Success, move to next page
        } catch (error) {
          lastError = error as Error;
          console.error(`[LibGen] Page ${page} failed:`, error);
          return allResults;
        }
      }
      
      // Small delay between pages
      if (pageAttempted && page < maxPages) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    console.log(`[LibGen] Reached max pages (${maxPages}), returning ${allResults.length} results`);
    return allResults;
  }

  /**
   * Search standard libgen mirrors (.is, .rs, .st, etc.)
   */
  private async searchStandard(
    baseUrl: string,
    searchQuery: string,
    column: string
  ): Promise<ShadowLibrarySearchResult[]> {
    const endpoint = `/search.php?req=${encodeURIComponent(searchQuery)}&column=${column}&phrase=0&view=simple&res=50&open=0`;

    try {
      const response = await this.makeRequest(`${baseUrl}${endpoint}`);
      const html = await response.text();

      console.log('[LibGen] Response received, HTML length:', html.length);
      console.log('[LibGen] URL used:', `${baseUrl}${endpoint}`);

      return this.parseSearchResults(html, baseUrl, 'standard');
    } catch (error) {
      console.error('[LibGen] Search failed:', error);

      // Try switching mirror and retry once
      const switched = await this.switchMirror();
      if (switched) {
        const newBaseUrl = this.getActiveMirrorUrl();
        if (newBaseUrl) {
          const newEndpoint = `/search.php?req=${encodeURIComponent(searchQuery)}&column=${column}&phrase=1&view=simple&res=25&open=0`;
          const response = await this.makeRequest(`${newBaseUrl}${newEndpoint}`);
          const html = await response.text();
          return this.parseSearchResults(html, newBaseUrl, 'standard');
        }
      }

      throw error;
    }
  }

  /**
   * Parse LibGen search results from HTML
   * @param html - The HTML response to parse
   * @param baseUrl - The base URL of the mirror
   * @param section - Optional section name for logging ('scientific', 'fiction', 'standard')
   */
  private parseSearchResults(
    html: string,
    baseUrl: string,
    section: string = 'standard'
  ): ShadowLibrarySearchResult[] {
    const results: ShadowLibrarySearchResult[] = [];

    // Check if we got an error page or captcha
    if (html.includes('captcha') || html.includes('Access denied')) {
      console.warn(`[LibGen] Possible captcha or access denied (${section})`);
      return [];
    }

    console.log(`[LibGen] Parsing ${section} section results...`);

    // Look for the main results table - try id="tablelibgen" first (most reliable)
    let tableHtml = '';
    let tableMatch = null;

    // First try: table with id="tablelibgen"
    tableMatch = html.match(/<table[^>]*id=["']tablelibgen["'][^>]*>([\s\S]*?)<\/table>/i);
    
    // Second try: table with class="table table-striped"
    if (!tableMatch) {
      tableMatch = html.match(/<table[^>]*class=["'][^"']*table[^"']*table-striped[^"']*["'][^>]*>([\s\S]*?)<\/table>/i);
    }
    if (!tableMatch) {
      // Try reverse order of classes
      tableMatch = html.match(/<table[^>]*class=["'][^"']*table-striped[^"']*table[^"']*["'][^>]*>([\s\S]*?)<\/table>/i);
    }

    // Third try: largest table (usually the results)
    if (!tableMatch) {
      const allTables = html.match(/<table[^>]*>([\s\S]*?)<\/table>/gi) || [];
      console.log(`[LibGen] Total tables found (${section}):`, allTables.length);
      
      if (allTables.length > 0) {
        let maxLen = 0;
        let maxIdx = 0;
        for (let i = 0; i < allTables.length; i++) {
          if (allTables[i].length > maxLen) {
            maxLen = allTables[i].length;
            maxIdx = i;
          }
        }
        if (maxLen > 1000) {
          console.log(`[LibGen] Using largest table (${section}, index ${maxIdx}, length: ${maxLen})`);
          tableMatch = [allTables[maxIdx], allTables[maxIdx]];
        }
      }
    }

    if (!tableMatch) {
      console.warn(`[LibGen] No results table found (${section})`);
      console.log(`[LibGen] HTML contains <table> (${section}):`, html.includes('<table'));
      console.log(`[LibGen] HTML contains table-striped (${section}):`, html.includes('table-striped'));
      console.log(`[LibGen] HTML contains tablelibgen (${section}):`, html.includes('tablelibgen'));
      return [];
    }

    tableHtml = tableMatch[1];
    console.log(`[LibGen] Table HTML length (${section}):`, tableHtml.length);

    // Extract ALL rows including tbody
    const rows = tableHtml.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];

    console.log(`[LibGen] Found rows (${section}):`, rows.length);

    // Process all rows (skip first if it's header)
    let startIndex = 0;

    // Check if first row is header (contains <th> tags)
    if (rows[0] && rows[0].includes('<th')) {
      startIndex = 1;
      console.log('[LibGen] Skipping header row');
    }

    console.log(`[LibGen] Processing ${rows.length - startIndex} data rows...`);

    for (let i = startIndex; i < rows.length; i++) {
      const row = rows[i];

      // Extract cells - libgen.li has 9 columns
      // Use regex to get content BETWEEN <td> tags, not including the tags themselves
      const cells: string[] = [];
      const cellMatches = row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi);
      for (const match of cellMatches) {
        cells.push(match[1]); // Get the content inside the <td> tags
      }

      // Require at least 8 cells (some rows may have merged cells)
      if (cells.length < 8) {
        continue;
      }

      try {
        const book = this.parseBookRow(cells, baseUrl);
        if (book) {
          results.push(this.bookToSearchResult(book));
        }
      } catch (error) {
        console.warn('[LibGen] Failed to parse row:', error);
      }
    }

    console.log('[LibGen] Total results:', results.length);

    return results;
  }

  /**
   * Parse a single table row into a book object (libgen.li format)
   *
   * Cell structure for libgen.li:
   * 0: Title (with series, ISBN links)
   * 1: Author(s)
   * 2: Publisher
   * 3: Year
   * 4: Language
   * 5: Pages
   * 6: Size (with file.php link)
   * 7: Extension
   * 8: Mirrors (with md5 links)
   */
  private parseBookRow(cells: string[], baseUrl: string): LibGenBook | null {
    // Helper to extract text from HTML
    const getText = (html: string): string => {
      return html
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();
    };

    // Extract all links from a cell
    const getAllHrefs = (html: string): string[] => {
      const matches = html.match(/href=["']([^"']+)["']/gi) || [];
      return matches.map(m => {
        const match = m.match(/href=["']([^"']+)["']/i);
        return match ? match[1] : '';
      }).filter(Boolean);
    };

    // Cell 0: Title - careful string parsing
    let titleHtml = cells[0] || '';
    
    // Strip any remaining <td> tags that might have leaked through
    titleHtml = titleHtml.replace(/^<td[^>]*>|<\/td>$/gi, '');

    let seriesText = '';
    let titleText = '';
    let isbnText = '';

    // Step 1: Remove ALL attributes including title (which contains extra text)
    let cleanHtml = titleHtml
      .replace(/<!--[\s\S]*?-->/g, '')  // Remove comments
      .replace(/\sdata-[^=\s]*=["'][^"']*["']/gi, '')  // Remove data-* attributes
      .replace(/\stitle=["'][^"']*["']/gi, '')  // Remove title attributes (contains extra text!)
      .replace(/\shref=["'][^"']*["']/gi, '')  // Remove href attributes
      .replace(/\sclass=["'][^"']*["']/gi, '')  // Remove class attributes
      .replace(/\sstyle=["'][^"']*["']/gi, '')  // Remove style attributes
      .replace(/\sid=["'][^"']*["']/gi, '')  // Remove id attributes
      .replace(/\son[a-z]*=["'][^"']*["']/gi, '')  // Remove onclick, etc.
      .replace(/data-[^=\s]*=["'][^"']*["']/gi, '')  // Remove data-* without leading space
      .replace(/title=["'][^"']*["']/gi, '')  // Remove title without leading space
      .replace(/href=["'][^"']*["']/gi, '')  // Remove href without leading space
      .replace(/class=["'][^"']*["']/gi, '')  // Remove class without leading space
      .replace(/style=["'][^"']*["']/gi, '')  // Remove style without leading space
      .replace(/\bid=["'][^"']*["']/gi, '')  // Remove id without leading space
      .replace(/on[a-z]*=["'][^"']*["']/gi, ''); // Remove onclick without leading space

    // Step 2: Split by <br> FIRST, then extract text from each segment
    const segments = cleanHtml.split(/<br\s*\/?>/i);

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];

      // Skip nobr segments (badges)
      if (segment.includes('<nobr>')) continue;

      // Remove ALL HTML tags from this segment
      const text = segment
        .replace(/<[^>]*>/g, ' ')  // Remove any remaining tags
        .replace(/[a-z-]+=["'][^"']*["']/gi, ' ')  // Remove any remaining attributes
        .replace(/\s+/g, ' ')
        .trim();

      if (!text || text.length < 2) continue;

      // Skip if text looks like HTML artifact
      if (text.includes('=') || text.includes('http') || text.includes('www')) continue;

      // Segment 0: Series (if contains <b>)
      if (i === 0 && segments[0].includes('<b')) {
        // Extract just the series name (text before first <a>)
        const beforeA = segment.split(/<a/i)[0];
        const seriesCandidate = beforeA
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (seriesCandidate && seriesCandidate.length > 2 && seriesCandidate.length < 200) {
          seriesText = seriesCandidate;
        }
      }
      // Segment 1+: Title (first substantial text after series)
      else if (!titleText && text.length > 3 && text.length < 300) {
        titleText = text;
      }
      // Segment 2+: ISBN
      else if (!isbnText && text.match(/\d{10,13}/)) {
        isbnText = text.substring(0, 50);
      }
    }

    // Fallback: if no title found, use raw text
    if (!titleText) {
      titleText = cleanHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 300);
    }

    // Final cleanup
    titleText = titleText
      .replace(/\s*\d{10,13}(?:[-\s]?\d)*\s*/g, '')  // Remove ISBN
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 300);

    titleText = titleText
      .replace(/["']+$/, '')  // Remove trailing quotes
      .replace(/\s*[-–—]\s*/g, ': ')  // Replace dashes with colons
      .replace(/_/g, ' ')     // Replace underscores with spaces
      .replace(/\s+/g, ' ')   // Normalize spaces
      .replace(/\s+#/, ' #')  // Ensure space before #
      .trim();

    if (!titleText || titleText.length < 2) {
      console.log('[LibGen] Row rejected: invalid title:', titleText);
      return null;
    }

    // Extract MD5 from mirrors cell (cell 8)
    // libgen.li uses /ads.php?md5=... pattern
    let md5 = '';
    let mirrorsHtml = '';
    let mirrorLinks: string[] = [];

    // Try cell 8 first (standard mirrors cell)
    if (cells[8]) {
      mirrorsHtml = cells[8];
      mirrorLinks = getAllHrefs(mirrorsHtml);

      for (const link of mirrorLinks) {
        // libgen.li uses /ads.php?md5=... pattern
        const md5Match = link.match(/[?&]md5=([a-f0-9]{32})/i);
        if (md5Match) {
          md5 = md5Match[1];
          break;
        }
      }
    }

    // Fallback: try to get MD5 from size cell (file.php?id=...)
    if (!md5 && cells[6]) {
      const sizeHtml = cells[6];
      const sizeLinks = getAllHrefs(sizeHtml);
      for (const link of sizeLinks) {
        // Try both md5= and id= patterns
        const md5Match = link.match(/[?&](md5|id)=([a-f0-9]{32})/i);
        if (md5Match) {
          md5 = md5Match[2];
          break;
        }
      }
    }

    if (!md5) {
      console.log('[LibGen] Row rejected: no MD5 found');
      return null;
    }

    // Cell 1: Authors
    // libgen.li has complex HTML with checkboxes for long author lists:
    // "Author1, Author2; Author3<input type="checkbox".../><label>[...]</label><div>More authors</div>"
    let authorsHtml = cells[1] || '';
    
    // Strip any remaining <td> tags
    authorsHtml = authorsHtml.replace(/^<td[^>]*>|<\/td>$/gi, '');

    // Extract text before any <input> tags (main authors)
    let authorsText = '';
    const inputMatch = authorsHtml.match(/<input/i);
    if (inputMatch && inputMatch.index !== undefined) {
      // Get text before the checkbox
      const beforeInput = authorsHtml.substring(0, inputMatch.index);
      authorsText = getText(beforeInput);
    } else {
      authorsText = getText(authorsHtml);
    }

    // Handle various author formats
    let authors: string[] = [];

    // Format 1: Semicolon-separated (libgen.li)
    if (authorsText.includes(';')) {
      authors = authorsText
        .split(';')
        .map(a => a.trim())
        .filter(a => a && a.length > 0);
    }
    // Format 2: Comma-separated
    else if (authorsText.includes(',')) {
      authors = authorsText
        .split(',')
        .map(a => a.trim())
        .filter(a => a && a.length > 0);
    }
    // Format 3: Single author or "by Author1, Author2"
    else {
      // Remove "by" prefix if present
      authorsText = authorsText.replace(/^by\s+/i, '');
      if (authorsText) {
        authors = [authorsText];
      }
    }

    // Clean up authors - remove common suffixes and role indicators
    authors = authors.map(a =>
      a.replace(/\s*\(.*?\)\s*/g, '')  // Remove parenthetical notes like "(Fictitious character)", "(Screenplay)"
        .replace(/\s+/g, ' ')
        .trim()
    ).filter(a => a && a.length > 0);

    // Accept rows with empty authors (some books might not have author listed)

    // Cell 2: Publisher
    const publisher = getText(cells[2] || '').trim();

    // Cell 3: Year
    const year = getText(cells[3] || '').trim();

    // Cell 4: Language
    const languageFull = getText(cells[4] || '').trim();
    const language = languageFull.toLowerCase();

    // Cell 5: Pages
    const pages = getText(cells[5] || '').trim();

    // Cell 6: Size (with link)
    const sizeHtml = cells[6] || '';
    const size = getText(sizeHtml).trim();

    // Cell 7: Extension
    const extension = getText(cells[7] || '').toLowerCase().trim();

    // Filter out comics and graphic novels (cbz, cbr, cb7)
    if (['cbz', 'cbr', 'cb7'].includes(extension)) {
      return null;
    }

    // Build mirrors list - libgen.li links FIRST
    const libgenMirrors: string[] = [];
    const otherMirrors: string[] = [];
    
    for (const link of mirrorLinks) {
      // libgen.li download links
      if (link.includes('/ads.php?md5=')) {
        const mirrorUrl = link.startsWith('http') ? link : `${baseUrl}${link}`;
        libgenMirrors.push(mirrorUrl);
      }
      // Other mirrors (Anna's Archive, etc.)
      else if (link.includes('randombook.org') ||
          link.includes('annas-archive') ||
          link.includes('libgen.pw') ||
          link.includes('libgen.is') ||
          link.includes('libgen.rs')) {
        const mirrorUrl = link.startsWith('http') ? link : `${baseUrl}${link}`;
        otherMirrors.push(mirrorUrl);
      }
    }
    
    // Combine: libgen.li mirrors first, then others
    const mirrors = [...libgenMirrors, ...otherMirrors];

    // Try to get cover URL - libgen.li uses /covers/ directory
    // Format: /covers/{first 2 chars of md5}/{md5}.1.jpg
    const coverUrl = md5 && md5.length >= 2
      ? `${baseUrl}/covers/${md5.substring(0, 2)}/${md5}.1.jpg`
      : undefined;

    return {
      id: md5,
      md5,
      title: titleText,
      authors,
      publisher,
      year,
      language,
      pages,
      size,
      extension,
      mirrors,
      coverUrl,
      series: seriesText || undefined,
      isbn: isbnText || undefined,
    };
  }

  /**
   * Convert book object to search result
   */
  private bookToSearchResult(book: LibGenBook): ShadowLibrarySearchResult {
    return {
      id: book.md5,
      title: book.title,
      authors: book.authors,
      publisher: book.publisher,
      year: book.year,
      language: book.language,
      format: book.extension.toUpperCase(),
      size: book.size,
      coverUrl: book.coverUrl,
      downloadUrl: book.mirrors[0],
      extensionData: {
        md5: book.md5,
        extension: book.extension,
        ...(book.series && { series: book.series }),
        ...(book.isbn && { isbn: book.isbn }),
      },
    };
  }

  /**
   * Get download URL for a specific book
   */
  async getDownloadUrl(resultId: string): Promise<string> {
    const baseUrl = this.getActiveMirrorUrl();
    if (!baseUrl) {
      throw new Error('No active mirror available');
    }

    // libgen.li uses /ads.php?md5=... for downloads
    if (baseUrl.includes('libgen.li')) {
      return `${baseUrl}/ads.php?md5=${resultId}`;
    }

    // Other mirrors use /ads.php?md5=... or /book/index.php?md5=...
    const bookPageUrl = `${baseUrl}/book/index.php?md5=${resultId}`;

    try {
      const response = await this.makeRequest(bookPageUrl);
      const html = await response.text();

      // Find download links in the page
      const downloadMatch = html.match(/href=["']([^"']*\/ads\.php\?md5=[a-f0-9]+[^"']*)["']/i);
      if (downloadMatch) {
        let downloadUrl = downloadMatch[1];
        if (!downloadUrl.startsWith('http')) {
          downloadUrl = `${baseUrl}${downloadUrl}`;
        }
        return downloadUrl;
      }

      // Fallback: use mirror links
      const mirrorMatch = html.match(/href=["']([^"']*libgen\.[^"']+)["']/gi);
      if (mirrorMatch && mirrorMatch.length > 0) {
        const mirror = mirrorMatch[0].match(/href=["']([^"']+)["']/i)?.[1];
        if (mirror) {
          return mirror.startsWith('http') ? mirror : `${baseUrl}${mirror}`;
        }
      }

      // Last resort: return book page
      return bookPageUrl;
    } catch (error) {
      console.error('[LibGen] Failed to get download URL:', error);
      return `${baseUrl}/ads.php?md5=${resultId}`;
    }
  }

  /**
   * Search by ISBN
   */
  async searchByISBN(isbn: string): Promise<ShadowLibrarySearchResult[]> {
    return this.search({ isbn });
  }

  /**
   * Get book metadata by MD5
   */
  async getMetadata(md5: string): Promise<ShadowLibrarySearchResult | null> {
    const baseUrl = this.getActiveMirrorUrl();
    if (!baseUrl) {
      return null;
    }

    try {
      // libgen.li uses /book/index.php?md5=... for book details
      const bookPageUrl = `${baseUrl}/book/index.php?md5=${md5}`;
      const response = await this.makeRequest(bookPageUrl);
      const html = await response.text();

      // Parse book details page
      const results = this.parseSearchResults(html, baseUrl, 'metadata');
      return results[0] || null;
    } catch (error) {
      console.error('[LibGen] Failed to get metadata:', error);
      return null;
    }
  }

  /**
   * Get cover image URL
   */
  getCoverUrl(md5: string): string {
    const baseUrl = this.getActiveMirrorUrl() || 'https://libgen.is';
    return `${baseUrl}/covers/${md5.substring(0, 2)}/${md5}.1.jpg`;
  }
}
