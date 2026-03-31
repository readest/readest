// RSS/Atom feed types for academic article feeds

export interface RSSFeed {
  metadata: {
    title?: string;
    subtitle?: string;
    description?: string;
    link?: string;
    language?: string;
    lastBuildDate?: string;
    pubDate?: string;
  };
  links: RSSLink[];
  items: RSSItem[];
}

export interface RSSItem {
  metadata: {
    title: string;
    link?: string;
    description?: string;
    content?: string;
    pubDate?: string;
    author?: string;
    guid?: string;
    doi?: string;
    journal?: string;
    publisher?: string;
    subject?: string[];
    // Fetched article content (from Readability)
    fetchedContent?: {
      title: string;
      content: string;
      author?: string;
      publishedTime?: string;
      excerpt?: string;
      siteName?: string;
      fetchedAt?: number;
    };
  };
  enclosures?: RSSEnclosure[];
  links: RSSLink[];
  // Article state management
  state?: ArticleState;
}

export interface ArticleState {
  guid: string;           // Unique article identifier (from RSS guid or generated hash)
  feedId: string;         // Which feed this belongs to
  savedAt?: number;       // Timestamp when saved to library
  bookmarkedAt?: number;  // Timestamp when bookmarked
  deletedAt?: number;     // Timestamp when marked for deletion
  readAt?: number;        // Timestamp when read
  bookHash?: string;      // If saved, the hash of the imported book
}

export interface ArticleManagementSettings {
  // Auto-cleanup settings
  autoCleanupEnabled: boolean;
  cleanupAfterDays: number;  // Delete articles older than X days
  excludeBookmarked: boolean; // Don't delete bookmarked articles
  excludeSaved: boolean;      // Don't delete saved articles (they're in library)
  
  // Storage format preference
  defaultSaveFormat: 'epub' | 'html';  // How to save articles to library
  
  // Article states (keyed by article GUID)
  articleStates: Record<string, ArticleState>;
}

export interface RSSLink {
  rel?: string;
  href: string;
  type?: string;
  title?: string;
  length?: string;
}

export interface RSSEnclosure {
  url: string;
  type?: string;
  length?: string;
}

export interface RSSCatalog {
  id: string;
  name: string;
  url: string;
  description?: string;
  disabled?: boolean;
  icon?: string;
  category?: string;
  username?: string;
  password?: string;
  isLocal?: boolean;
  fileContent?: string; // For local RSS files
  folder?: string; // For organizing feeds into folders
  tags?: string[]; // For tagging feeds
  priority?: boolean; // Mark as favorite/priority feed
  color?: string; // Custom color for feed icon
}

// Pre-configured academic RSS/Atom feeds
export const ACADEMIC_FEEDS: RSSCatalog[] = [
  {
    id: 'arxiv-csai',
    name: 'arXiv: AI',
    url: 'https://export.arxiv.org/rss/cs.AI',
    description: 'Artificial Intelligence preprints',
    icon: '🤖',
    category: 'arXiv',
  },
];

export const REL = {
  ENCLOSURE: 'enclosure',
  ALTERNATE: 'alternate',
  RELATED: 'related',
};

export const MIME = {
  RSS: 'application/rss+xml',
  ATOM: 'application/atom+xml',
  PDF: 'application/pdf',
  HTML: 'text/html',
};
