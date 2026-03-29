import { RSSFeed, RSSItem } from '@/types/rss';
import {
  getAPIBaseUrl,
  isTauriAppPlatform,
  isWebAppPlatform,
} from '@/services/environment';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { READEST_OPDS_USER_AGENT } from '@/services/constants';

const RSS_PROXY_URL = `${getAPIBaseUrl()}/rss/proxy`;

/**
 * Get proxy URL for RSS feeds (web platform only)
 */
const getProxiedURL = (url: string): string => {
  if (url.startsWith('http') && isWebAppPlatform()) {
    const params = new URLSearchParams();
    params.append('url', url);
    return `${RSS_PROXY_URL}?${params.toString()}`;
  }
  return url;
};

/**
 * Extract DOI from text content or URL
 */
export const extractDOI = (text: string): string | undefined => {
  if (!text) return undefined;
  
  // First, try to extract DOI from href attributes in links
  // Matches: href="https://doi.org/10.xxx", href="https://dx.doi.org/10.xxx"
  const hrefPatterns = [
    /href=["']https?:\/\/doi\.org\/(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)["']/i,
    /href=["']https?:\/\/dx\.doi\.org\/(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)["']/i,
    /href=["']\/doi\/(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)["']/i,
  ];
  
  for (const pattern of hrefPatterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1];
    }
  }
  
  // Then try plain text DOI patterns
  const textPatterns = [
    /10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i,
    /doi:\s*(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)/i,
    /DOI:\s*(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)/i,
  ];

  for (const pattern of textPatterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1];
    }
  }
  return undefined;
};

/**
 * Extract DOI from a URL (for links like psycnet.apa.org/doi/10.xxx)
 */
export const extractDOIFromUrl = (url: string): string | undefined => {
  if (!url) return undefined;
  
  // Check for DOI in URL path
  const patterns = [
    /psycnet\.apa\.org\/doi\/(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)/i,
    /\/doi\/(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)/i,
    /\/full\/(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)/i,
    /\/article\/(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)/i,
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return match[1];
    }
  }
  
  // Also try general DOI extraction from URL
  return extractDOI(url);
};

/**
 * Extract PDF URL from enclosure or links
 */
export const extractPDFUrl = (item: RSSItem): string | undefined => {
  // Check enclosures first
  if (item.enclosures) {
    for (const enclosure of item.enclosures) {
      if (enclosure.type?.includes('pdf') || enclosure.url.endsWith('.pdf')) {
        return enclosure.url;
      }
    }
  }

  // Check links
  if (item.links) {
    for (const link of item.links) {
      if (link.type?.includes('pdf') || link.href.endsWith('.pdf')) {
        return link.href;
      }
    }
  }

  // Check description for PDF links
  if (item.metadata.description) {
    const pdfMatch = item.metadata.description.match(
      /https?:\/\/[^\s"'<>]+\.pdf(?:[^\s"'<>]*)?/i,
    );
    if (pdfMatch) {
      return pdfMatch[0];
    }
  }

  return undefined;
};

/**
 * Parse RSS/Atom feed from XML string
 */
const parseRSSFeed = (xmlText: string): RSSFeed => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'text/xml');

  // Check for parse errors
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error('Failed to parse RSS feed');
  }

  const feed: RSSFeed = {
    metadata: {},
    links: [],
    items: [],
  };

  // Detect feed type (RSS or Atom)
  const isAtom = doc.querySelector('feed') !== null;

  if (isAtom) {
    // Atom feed
    const feedEl = doc.querySelector('feed');
    if (!feedEl) throw new Error('Invalid Atom feed');

    feed.metadata = {
      title: feedEl.querySelector('title')?.textContent || undefined,
      subtitle: feedEl.querySelector('subtitle')?.textContent || undefined,
      description: feedEl.querySelector('subtitle')?.textContent || undefined,
      link: feedEl.querySelector('link')?.getAttribute('href') || undefined,
      language: feedEl.querySelector('language')?.textContent || undefined,
      lastBuildDate: feedEl.querySelector('updated')?.textContent || undefined,
    };

    const linkEl = feedEl.querySelector('link');
    if (linkEl) {
      feed.links.push({
        href: linkEl.getAttribute('href') || '',
        rel: linkEl.getAttribute('rel') || 'alternate',
        type: linkEl.getAttribute('type') || undefined,
      });
    }

    const entries = feedEl.querySelectorAll('entry');
    feed.items = Array.from(entries).map((entry) => parseAtomItem(entry));
  } else {
    // RSS feed
    const channel = doc.querySelector('channel');
    if (!channel) throw new Error('Invalid RSS feed');

    feed.metadata = {
      title: channel.querySelector('title')?.textContent || undefined,
      description: channel.querySelector('description')?.textContent || undefined,
      link: channel.querySelector('link')?.textContent || undefined,
      language: channel.querySelector('language')?.textContent || undefined,
      lastBuildDate: channel.querySelector('lastBuildDate')?.textContent || undefined,
      pubDate: channel.querySelector('pubDate')?.textContent || undefined,
    };

    const linkEl = channel.querySelector('link');
    if (linkEl) {
      feed.links.push({
        href: linkEl.textContent || '',
      });
    }

    const items = channel.querySelectorAll('item');
    feed.items = Array.from(items).map((item) => parseRSSItem(item));
  }

  return feed;
};

/**
 * Parse individual Atom entry
 */
const parseAtomItem = (entryEl: Element): RSSItem => {
  const item: RSSItem = {
    metadata: {
      title: entryEl.querySelector('title')?.textContent || '',
      link: entryEl.querySelector('link')?.getAttribute('href') || undefined,
      description: entryEl.querySelector('summary')?.textContent || undefined,
      content: entryEl.querySelector('content')?.textContent || undefined,
      pubDate: entryEl.querySelector('updated')?.textContent || undefined,
      author: entryEl.querySelector('author > name')?.textContent || undefined,
      guid: entryEl.querySelector('id')?.textContent || undefined,
      journal: undefined,
      publisher: undefined,
      subject: [],
    },
    enclosures: [],
    links: [],
  };

  // Extract DOI from content, description, or URL
  const content = item.metadata.content || item.metadata.description || '';
  if (content) {
    const doi = extractDOI(content);
    if (doi) {
      item.metadata.doi = doi;
    }
  }
  
  // Also try extracting DOI from the link URL
  if (!item.metadata.doi && item.metadata.link) {
    const doiFromUrl = extractDOIFromUrl(item.metadata.link);
    if (doiFromUrl) {
      item.metadata.doi = doiFromUrl;
      console.log('[RSS Fetcher] Extracted DOI from URL:', doiFromUrl);
    }
  }

  // Extract enclosures
  const enclosures = entryEl.querySelectorAll('link[rel="enclosure"]');
  item.enclosures = Array.from(enclosures).map((el) => ({
    url: el.getAttribute('href') || '',
    type: el.getAttribute('type') || undefined,
    length: el.getAttribute('length') || undefined,
  }));

  // Extract links
  const links = entryEl.querySelectorAll('link:not([rel="enclosure"])');
  item.links = Array.from(links).map((el) => ({
    href: el.getAttribute('href') || '',
    rel: el.getAttribute('rel') || 'alternate',
    type: el.getAttribute('type') || undefined,
  }));

  // Extract categories/subjects
  const categories = entryEl.querySelectorAll('category');
  item.metadata.subject = Array.from(categories)
    .map((el) => el.getAttribute('term'))
    .filter(Boolean) as string[];

  return item;
};

/**
 * Parse individual RSS item
 */
const parseRSSItem = (itemEl: Element): RSSItem => {
  const item: RSSItem = {
    metadata: {
      title: itemEl.querySelector('title')?.textContent || '',
      link: itemEl.querySelector('link')?.textContent || undefined,
      description: itemEl.querySelector('description')?.textContent || undefined,
      content: itemEl.querySelector('content\\:encoded')?.textContent || undefined,
      pubDate: itemEl.querySelector('pubDate')?.textContent || undefined,
      author: itemEl.querySelector('author')?.textContent || undefined,
      guid: itemEl.querySelector('guid')?.textContent || undefined,
      journal: undefined,
      publisher: undefined,
      subject: [],
    },
    enclosures: [],
    links: [],
  };

  // Extract DOI from content, description, or URL
  const content = item.metadata.content || item.metadata.description || '';
  if (content) {
    const doi = extractDOI(content);
    if (doi) {
      item.metadata.doi = doi;
    }
  }
  
  // Also try extracting DOI from the link URL
  if (!item.metadata.doi && item.metadata.link) {
    const doiFromUrl = extractDOIFromUrl(item.metadata.link);
    if (doiFromUrl) {
      item.metadata.doi = doiFromUrl;
      console.log('[RSS Fetcher] Extracted DOI from URL:', doiFromUrl);
    }
  }

  // Extract enclosure
  const enclosureEl = itemEl.querySelector('enclosure');
  if (enclosureEl) {
    item.enclosures = [
      {
        url: enclosureEl.getAttribute('url') || '',
        type: enclosureEl.getAttribute('type') || undefined,
        length: enclosureEl.getAttribute('length') || undefined,
      },
    ];
  }

  // Add main link
  if (item.metadata.link) {
    item.links.push({
      href: item.metadata.link,
      rel: 'alternate',
    });
  }

  // Extract categories
  const categories = itemEl.querySelectorAll('category');
  item.metadata.subject = Array.from(categories)
    .map((el) => el.textContent)
    .filter(Boolean) as string[];

  return item;
};

/**
 * Fetch and parse RSS feed
 */
export const fetchRSSFeed = async (url: string, fileContent?: string): Promise<RSSFeed> => {
  // Handle local feeds with stored content
  if (fileContent) {
    console.log('Loading local RSS feed from stored content, length:', fileContent.length);
    try {
      return parseRSSFeed(fileContent);
    } catch (e) {
      console.error('Failed to parse local RSS content:', e);
      console.log('First 500 chars:', fileContent.slice(0, 500));
      throw e;
    }
  }

  if (!url) {
    throw new Error('No URL or content provided for RSS feed');
  }

  const fetchURL = isWebAppPlatform() ? getProxiedURL(url) : url;
  const headers: Record<string, string> = {
    'User-Agent': READEST_OPDS_USER_AGENT,
    Accept: 'application/rss+xml, application/atom+xml, application/xml, */*',
  };

  const fetch = isTauriAppPlatform() ? tauriFetch : window.fetch;
  
  // Add timeout for slow feeds
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout
  
  try {
    const res = await fetch(fetchURL, {
      method: 'GET',
      headers,
      signal: controller.signal,
      danger: { acceptInvalidCerts: true, acceptInvalidHostnames: true },
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const errorMsg = res.status === 500 
        ? `Feed server error (${res.status}). The feed may be temporarily unavailable.`
        : `Failed to fetch RSS feed: ${res.status} ${res.statusText}`;
      console.error(`[RSS Fetcher] ${errorMsg} - URL: ${url}`);
      throw new Error(errorMsg);
    }

    const text = await res.text();
    return parseRSSFeed(text);
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Feed request timed out. The server may be slow or unavailable.');
    }
    throw error;
  }
};

/**
 * Validate RSS URL
 */
export const validateRSSURL = async (url: string): Promise<boolean> => {
  try {
    const feed = await fetchRSSFeed(url);
    return feed.items.length > 0;
  } catch {
    return false;
  }
};
