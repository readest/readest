import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import {
  getAPIBaseUrl,
  isTauriAppPlatform,
  isWebAppPlatform,
} from '@/services/environment';
import { READEST_OPDS_USER_AGENT } from '@/services/constants';
import DOMPurify from 'dompurify';

const ARTICLE_PROXY_URL = `${getAPIBaseUrl()}/rss/article-proxy`;

/**
 * Get proxy URL for article fetching (web platform only)
 */
const getProxiedURL = (url: string): string => {
  if (url.startsWith('http') && isWebAppPlatform()) {
    const params = new URLSearchParams();
    params.append('url', url);
    return `${ARTICLE_PROXY_URL}?${params.toString()}`;
  }
  return url;
};

/**
 * Fetch and extract full article content from a URL using Readability
 * Returns cleaned article content suitable for display
 */
export interface ArticleContent {
  title: string;
  content: string;
  author?: string;
  publishedTime?: string;
  excerpt?: string;
  siteName?: string;
  originalUrl: string;
}

export interface FetchArticleOptions {
  /** Sanitize the content (default: true) */
  sanitize?: boolean;
  /** Preserve images in the content (default: true) */
  keepImages?: boolean;
  /** Maximum content length (0 = unlimited, default: 0) */
  maxLength?: number;
}

/**
 * Fetch HTML content from a URL
 */
async function fetchHTML(url: string): Promise<string> {
  const fetchURL = isWebAppPlatform() ? getProxiedURL(url) : url;
  const headers: Record<string, string> = {
    'User-Agent': READEST_OPDS_USER_AGENT,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  const fetch = isTauriAppPlatform() ? tauriFetch : window.fetch;
  const res = await fetch(fetchURL, {
    method: 'GET',
    headers,
    danger: { acceptInvalidCerts: true, acceptInvalidHostnames: true },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch article: ${res.status} ${res.statusText}`);
  }

  return await res.text();
}

/**
 * Extract article content from HTML using Readability
 */
function extractArticle(html: string, url: string): ArticleContent {
  // Dynamically import Readability to avoid SSR issues
  const { Readability } = require('@mozilla/readability') as typeof import('@mozilla/readability');

  // Create a DOM document from the HTML
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Fix relative URLs in the document BEFORE Readability processes it
  fixRelativeUrls(doc, url);

  // Extract RELEVANT images from the original HTML BEFORE Readability strips them
  // We want to exclude: nav icons, ads, social sharing, related articles, author avatars, etc.
  const allImages = Array.from(doc.querySelectorAll('article img, .article-content img, .post-content img, .entry-content img, main img, .post img, .content img'))
    .map((img) => ({
      src: img.getAttribute('src') || '',
      alt: img.getAttribute('alt') || '',
      title: img.getAttribute('title') || '',
      parentClass: img.parentElement?.className || '',
      parentTag: img.parentElement?.tagName || '',
      sizes: img.getAttribute('sizes') || '',
      srcset: img.getAttribute('srcset') || '',
    }))
    .filter((img) => img.src && !img.src.startsWith('data:'));

  // Filter out non-content images
  const originalImages = allImages.filter((img) => {
    // Filter out obvious non-content images
    const excludePatterns = [
      /avatar/i,
      /profile/i,
      /author/i,
      /social/i,
      /share/i,
      /icon/i,
      /logo/i,
      /ad[-_]?/i,
      /banner/i,
      /sponsor/i,
      /related/i,
      /recommended/i,
      /sidebar/i,
      /widget/i,
      /nav/i,
      /menu/i,
      /gravatar/i,
      /user/i,
      /comment/i,
    ];
    
    // Check if image or its parent has excluded class names
    const classStr = img.parentClass + ' ' + img.alt + ' ' + img.title + ' ' + img.parentTag;
    if (excludePatterns.some((pattern) => pattern.test(classStr))) {
      return false;
    }
    
    // Filter by size - very small images are likely icons/decorative
    // We can't check actual dimensions, but we can check if sizes attribute suggests small display
    if (img.sizes && /100px|50px|32px|24px|16px/i.test(img.sizes)) {
      return false;
    }
    
    return true;
  });

  // Also find the featured/hero image (usually the largest, above the title)
  const featuredImage = doc.querySelector('meta[property="og:image"]')?.getAttribute('content') ||
                        doc.querySelector('meta[name="twitter:image"]')?.getAttribute('content') ||
                        doc.querySelector('.featured-image img')?.getAttribute('src') ||
                        doc.querySelector('.post-thumbnail img')?.getAttribute('src') ||
                        undefined;

  console.log('[ArticleFetcher] Found', originalImages.length, 'content images + featured:', !!featuredImage);

  // Parse with Readability - use more permissive settings
  const reader = new Readability(doc, {
    charThreshold: 100, // Lower threshold to catch shorter articles
    keepClasses: true, // Keep some classes for styling
    classesToPreserve: ['wp-block-image', 'figure', 'caption', 'aligncenter', 'alignleft', 'alignright'],
  });

  const article = reader.parse();

  if (!article) {
    throw new Error('Could not extract article content - page may not contain readable content');
  }

  console.log('[ArticleFetcher] Readability parse result:', {
    title: article.title,
    contentLength: article.content?.length || 0,
    byline: article.byline,
    siteName: article.siteName,
  });

  // Post-process the content to fix remaining issues
  let content = article.content || '';
  
  console.log('[ArticleFetcher] Raw Readability output:', {
    title: article.title,
    contentLength: content.length,
    imageCount: (content.match(/<img/gi) || []).length,
  });
  
  // If Readability stripped out images, add back ONLY the featured image
  // This keeps the article clean and focused on text
  if (featuredImage) {
    const temp = document.createElement('div');
    temp.innerHTML = content;
    
    // Check if featured image is already in content
    const existingImageSrcs = new Set(
      Array.from(temp.querySelectorAll('img')).map((img) => img.getAttribute('src'))
    );
    
    if (!existingImageSrcs.has(featuredImage)) {
      console.log('[ArticleFetcher] Adding featured image at top of article');
      
      // Create featured image container
      const figure = document.createElement('figure');
      figure.className = 'featured-image';
      figure.style.margin = '0 0 2rem 0';
      
      const img = document.createElement('img');
      img.src = featuredImage;
      img.alt = article.title || '';
      img.style.width = '100%';
      img.style.height = 'auto';
      img.style.borderRadius = '0.5rem';
      
      figure.appendChild(img);
      
      // Insert at the top of the content
      const firstChild = temp.firstChild;
      if (firstChild) {
        temp.insertBefore(figure, firstChild);
      } else {
        temp.appendChild(figure);
      }
      
      content = temp.innerHTML;
    }
  }
  
  content = fixImageUrls(content, url);
  content = removeReadMoreLinks(content);
  content = removeLazyLoadingAttributes(content);
  
  console.log('[ArticleFetcher] After post-processing:', {
    imageCount: (content.match(/<img/gi) || []).length,
  });

  return {
    title: article.title || 'Untitled Article',
    content,
    author: article.byline || undefined,
    publishedTime: article.publishedTime || undefined,
    excerpt: article.excerpt || undefined,
    siteName: article.siteName || undefined,
    originalUrl: url,
  } as ArticleContent;
}

/**
 * Fix relative URLs in a document to be absolute
 */
function fixRelativeUrls(doc: Document, baseUrl: string) {
  // Fix all href and src attributes
  const elements = doc.querySelectorAll('[href], [src], [data-src], [srcset]');
  elements.forEach((el) => {
    const href = el.getAttribute('href');
    const src = el.getAttribute('src');
    const dataSrc = el.getAttribute('data-src');
    const srcset = el.getAttribute('srcset');

    if (href && !href.startsWith('data:') && !href.startsWith('blob:')) {
      try {
        el.setAttribute('href', new URL(href, baseUrl).href);
      } catch {
        // Invalid URL, leave as is
      }
    }
    if (src && !src.startsWith('data:') && !src.startsWith('blob:')) {
      try {
        el.setAttribute('src', new URL(src, baseUrl).href);
      } catch {
        // Invalid URL, leave as is
      }
    }
    if (dataSrc && !dataSrc.startsWith('data:') && !dataSrc.startsWith('blob:')) {
      try {
        el.setAttribute('data-src', new URL(dataSrc, baseUrl).href);
      } catch {
        // Invalid URL, leave as is
      }
    }
    if (srcset) {
      // Fix each URL in srcset
      const fixedSrcset = srcset.split(',').map((src) => {
        const parts = src.trim().split(' ');
        if (parts[0] && !parts[0].startsWith('data:') && !parts[0].startsWith('blob:')) {
          try {
            parts[0] = new URL(parts[0], baseUrl).href;
          } catch {
            // Invalid URL, leave as is
          }
        }
        return parts.join(' ');
      }).join(', ');
      el.setAttribute('srcset', fixedSrcset);
    }
  });
}

/**
 * Fix image URLs in HTML content to be absolute and properly encoded
 * Also proxies images that might have hotlinking protection
 */
function fixImageUrls(content: string, baseUrl: string): string {
  const temp = document.createElement('div');
  temp.innerHTML = content;

  const images = temp.querySelectorAll('img');
  images.forEach((img) => {
    const src = img.getAttribute('src');
    const dataSrc = img.getAttribute('data-src');
    const dataOriginalSrc = img.getAttribute('data-original-src');

    // Try to get the best available image source
    let bestSrc = dataOriginalSrc || dataSrc || src;
    
    if (bestSrc && !bestSrc.startsWith('data:') && !bestSrc.startsWith('blob:')) {
      try {
        // Decode any double-encoded URLs (common issue with CMS exports)
        let decoded = bestSrc;
        try {
          // Try decoding - if it's double-encoded, this will help
          decoded = decodeURIComponent(decodeURIComponent(bestSrc));
        } catch {
          // If decoding fails, use original
          decoded = bestSrc;
        }
        
        // Convert to absolute URL
        let absoluteUrl = new URL(decoded, baseUrl).href;
        
        // For known hotlinking-protected CDNs, use our proxy
        const hotlinkProtectedDomains = [
          'media.pitchfork.com',
          'cdn.condenast.com',
          'assets.vogue.com',
          'media.newyorker.com',
          'assets.gq.com',
          'cdn.arstechnica.net',
        ];
        
        const urlObj = new URL(absoluteUrl);
        if (hotlinkProtectedDomains.some((domain) => urlObj.hostname.includes(domain))) {
          // Route through our article proxy to bypass hotlinking protection
          absoluteUrl = `/api/rss/article-proxy?url=${encodeURIComponent(absoluteUrl)}`;
          console.log('[ArticleFetcher] Using proxy for hotlinking-protected image:', urlObj.hostname);
        }
        
        img.setAttribute('src', absoluteUrl);
      } catch (e) {
        console.warn('[ArticleFetcher] Failed to fix image URL:', bestSrc, e);
      }
    }

    // Remove lazy loading attributes that might block images
    img.removeAttribute('loading');
    img.removeAttribute('data-lazy');
    img.removeAttribute('data-lazyload');
    
    // Add crossorigin for images that might be on different domains
    if (img.src && !img.src.startsWith(window.location.origin) && !img.src.startsWith('/api/')) {
      img.setAttribute('crossorigin', 'anonymous');
    }
  });

  return temp.innerHTML;
}

/**
 * Remove "read more" and similar links from content
 */
function removeReadMoreLinks(content: string): string {
  const temp = document.createElement('div');
  temp.innerHTML = content;

  // Find and remove common "read more" patterns
  const links = temp.querySelectorAll('a');
  links.forEach((link) => {
    const text = link.textContent?.toLowerCase() || '';
    const patterns = [
      'read more',
      'read full',
      'read full story',
      'continue reading',
      'keep reading',
      'full article',
      'view full',
      'see more',
      'more...',
      '…',
    ];

    if (patterns.some((pattern) => text.includes(pattern))) {
      // Remove the link but keep the text if it's meaningful
      const parent = link.parentElement;
      if (parent && parent.tagName === 'P' && parent.children.length === 1) {
        parent.remove();
      } else {
        link.remove();
      }
    }
  });

  return temp.innerHTML;
}

/**
 * Remove lazy loading attributes that might prevent images from loading
 */
function removeLazyLoadingAttributes(content: string): string {
  const temp = document.createElement('div');
  temp.innerHTML = content;

  const images = temp.querySelectorAll('img');
  images.forEach((img) => {
    // Remove lazy loading attributes
    ['loading', 'data-lazy', 'data-lazyload', 'data-src', 'data-original', 
     'data-original-src', 'data-retina', 'data-srcset', 'class'].forEach((attr) => {
      if (attr === 'class') {
        const className = img.getAttribute('class') || '';
        // Remove lazy loading related classes
        const filteredClasses = className.split(' ')
          .filter((c) => !c.match(/lazy|loading|placeholder/i))
          .join(' ');
        if (filteredClasses) {
          img.setAttribute('class', filteredClasses);
        } else {
          img.removeAttribute('class');
        }
      } else {
        img.removeAttribute(attr);
      }
    });
  });

  return temp.innerHTML;
}

/**
 * Truncate content to maximum length while preserving HTML tags
 */
function truncateContent(content: string, maxLength: number): string {
  if (maxLength <= 0 || content.length <= maxLength) {
    return content;
  }

  // Simple truncation - find a good breaking point
  const truncated = content.slice(0, maxLength);
  const lastParagraphEnd = truncated.lastIndexOf('</p>');
  const lastSectionEnd = truncated.lastIndexOf('</section>');
  const lastDivEnd = truncated.lastIndexOf('</div>');

  // Try to end at a natural boundary
  const breakPoint = Math.max(lastParagraphEnd, lastSectionEnd, lastDivEnd);
  if (breakPoint > maxLength * 0.5) {
    return truncated.slice(0, breakPoint + 4); // Include closing tag
  }

  return truncated + '...';
}

/**
 * Fetch and extract full article content from a URL
 * 
 * @param url - The URL of the article to fetch
 * @param options - Fetch options
 * @returns Extracted article content
 */
export const fetchArticleContent = async (
  url: string,
  options: FetchArticleOptions = {}
): Promise<ArticleContent> => {
  const {
    sanitize = true,
    keepImages = true,
    maxLength = 0,
  } = options;

  try {
    // 1. Fetch HTML from URL
    const html = await fetchHTML(url);

    // 2. Extract article content using Readability
    let article = extractArticle(html, url);

    // 3. Optionally remove images
    if (!keepImages) {
      const temp = document.createElement('div');
      temp.innerHTML = article.content;
      temp.querySelectorAll('img').forEach((img) => img.remove());
      temp.querySelectorAll('figure').forEach((figure) => figure.remove());
      article.content = temp.innerHTML;
    }

    // 4. Sanitize content for safe display
    if (sanitize) {
      const imageCountBefore = (article.content.match(/<img/gi) || []).length;
      
      // Use DOMPurify directly for HTML sanitization
      article.content = DOMPurify.sanitize(article.content, {
        WHOLE_DOCUMENT: false,
        FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
        ALLOWED_URI_REGEXP:
          /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|blob|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
        ADD_TAGS: ['link', 'meta'],
        ADD_ATTR: (attributeName: string) => {
          const attrWhitelist = [
            'xmlns',
            'http-equiv',
            'content',
            'charset',
            'link',
            'vlink',
            'data-*',
            // Image attributes
            'src',
            'srcset',
            'sizes',
            'alt',
            'title',
            'width',
            'height',
            'loading',
            'decoding',
            'fetchpriority',
            // Figure/figcaption attributes
            'typeof',
            'property',
          ];
          return (
            attrWhitelist.includes(attributeName) ||
            attributeName.startsWith('xml:') ||
            attributeName.startsWith('xmlns:') ||
            attributeName.startsWith('epub:') ||
            attributeName.startsWith('data-')
          );
        },
        // Keep figures and their captions
        ALLOW_DATA_ATTR: true,
      });
      
      const imageCountAfter = (article.content.match(/<img/gi) || []).length;
      console.log('[ArticleFetcher] Sanitization:', {
        imagesBefore: imageCountBefore,
        imagesAfter: imageCountAfter,
      });
    }

    // 5. Truncate if needed
    if (maxLength > 0) {
      article.content = truncateContent(article.content, maxLength);
    }

    console.log('Article fetched successfully:', {
      title: article.title,
      contentLength: article.content.length,
      hasAuthor: !!article.author,
    });

    return article;
  } catch (error) {
    console.error('Failed to fetch article content:', error);
    throw error;
  }
};

/**
 * Test if a URL contains readable article content
 */
export const testArticleAvailability = async (url: string): Promise<boolean> => {
  try {
    const html = await fetchHTML(url);
    const { Readability } = require('@mozilla/readability') as typeof import('@mozilla/readability');
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const reader = new Readability(doc);
    const article = reader.parse();
    return article !== null && !!article.content && article.content.length > 500;
  } catch {
    return false;
  }
};
