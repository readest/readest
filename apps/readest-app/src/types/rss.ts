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
  };
  enclosures?: RSSEnclosure[];
  links: RSSLink[];
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
