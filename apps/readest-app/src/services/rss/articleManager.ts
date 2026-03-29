import { ArticleState, RSSItem } from '@/types/rss';
import { SystemSettings } from '@/types/settings';
import { useSettingsStore } from '@/store/settingsStore';
import { saveSysSettings } from '@/helpers/settings';
import { md5 } from '@/utils/md5';
import environmentConfig from '@/services/environment';

/**
 * Generate a unique GUID for an article
 * Uses DOI if available, otherwise falls back to hash of title + URL
 */
export const generateArticleGuid = (item: RSSItem): string => {
  // Prefer DOI as it's globally unique
  if (item.metadata.doi) {
    return `doi:${item.metadata.doi}`;
  }
  
  // Use RSS guid if available
  if (item.metadata.guid) {
    return item.metadata.guid;
  }
  
  // Fall back to hash of title + URL
  const key = `${item.metadata.title}|${item.metadata.link || ''}`;
  return `hash:${md5(key)}`;
};

/**
 * Get article state from settings
 */
export const getArticleState = (guid: string): ArticleState | undefined => {
  const settings = useSettingsStore.getState().settings;
  return settings.articleManagement?.articleStates?.[guid];
};

/**
 * Update article state
 */
export const updateArticleState = async (
  guid: string,
  feedId: string,
  updates: Partial<ArticleState>
): Promise<void> => {
  const settings = useSettingsStore.getState().settings;
  
  const currentState = settings.articleManagement?.articleStates?.[guid] || {
    guid,
    feedId,
  };
  
  const newState: ArticleState = {
    ...currentState,
    ...updates,
  };
  
  const newArticleStates = {
    ...settings.articleManagement?.articleStates,
    [guid]: newState,
  };
  
  const newArticleManagement = {
    ...settings.articleManagement,
    articleStates: newArticleStates,
  };
  
  // Save to settings file FIRST (before updating Zustand)
  await saveSysSettings(environmentConfig, 'articleManagement', newArticleManagement);
  
  // Then update Zustand store (for immediate UI update)
  useSettingsStore.getState().setSettings({
    ...settings,
    articleManagement: newArticleManagement,
  });
};

/**
 * Bookmark an article (keeps it in feeds view, prevents auto-deletion)
 */
export const bookmarkArticle = async (item: RSSItem, feedId: string): Promise<void> => {
  const guid = generateArticleGuid(item);
  await updateArticleState(guid, feedId, {
    bookmarkedAt: Date.now(),
    deletedAt: undefined, // Remove deletion flag if set
  });
  
  // Update the item's state
  item.state = {
    ...item.state,
    guid,
    feedId,
    bookmarkedAt: Date.now(),
    deletedAt: undefined,
  };
};

/**
 * Unbookmark an article
 */
export const unbookmarkArticle = async (item: RSSItem): Promise<void> => {
  const guid = generateArticleGuid(item);
  await updateArticleState(guid, item.state?.feedId || '', {
    bookmarkedAt: undefined,
  });
  
  if (item.state) {
    item.state.bookmarkedAt = undefined;
  }
};

/**
 * Toggle bookmark state
 */
export const toggleBookmark = async (item: RSSItem, feedId: string): Promise<void> => {
  const guid = generateArticleGuid(item);
  const currentState = getArticleState(guid);
  
  if (currentState?.bookmarkedAt) {
    await unbookmarkArticle(item);
  } else {
    await bookmarkArticle(item, feedId);
  }
};

/**
 * Delete an article immediately (removes from state)
 */
export const deleteArticle = async (item: RSSItem): Promise<void> => {
  const guid = generateArticleGuid(item);
  const settings = useSettingsStore.getState().settings;
  const setSettings = useSettingsStore.getState().setSettings;
  
  // Remove the article state entirely
  const newArticleStates = { ...settings.articleManagement?.articleStates };
  delete newArticleStates[guid];
  
  const newSettings: SystemSettings = {
    ...settings,
    articleManagement: {
      ...settings.articleManagement,
      articleStates: newArticleStates,
    },
  };
  
  // Update Zustand first
  setSettings(newSettings);
  
  // Then save to disk
  await saveSysSettings(environmentConfig, 'articleManagement', newSettings.articleManagement);
};

/**
 * Undelete article (no longer needed - deletion is immediate)
 * Kept for backwards compatibility if needed
 */
export const undeleteArticle = async (_item: RSSItem): Promise<void> => {
  // No-op - articles are deleted immediately
  console.warn('undeleteArticle is deprecated - deletion is now immediate');
};

/**
 * Save article to library (imports as EPUB book)
 */
export const saveArticleToLibrary = async (
  item: RSSItem,
  _feedId: string,
  _format: 'epub' | 'html' = 'html'
): Promise<void> => {
  const guid = generateArticleGuid(item);
  const settings = useSettingsStore.getState().settings;
  const setSettings = useSettingsStore.getState().setSettings;
  const envConfig = environmentConfig;
  
  try {
    // Get article content (prefer fetched content, fall back to description)
    const content = item.metadata.fetchedContent?.content || item.metadata.content || item.metadata.description || '';
    const title = item.metadata.fetchedContent?.title || item.metadata.title;
    const author = item.metadata.fetchedContent?.author || item.metadata.author;
    const pubDate = item.metadata.fetchedContent?.publishedTime || item.metadata.pubDate;
    
    if (!content) {
      throw new Error('No article content available to save');
    }
    
    // If we don't have fetched content, fetch it now
    let articleContent = content;
    if (!item.metadata.fetchedContent?.content && item.metadata.link) {
      try {
        console.log('[ArticleManager] Fetching full article content...');
        const { fetchArticleContent } = await import('./articleFetcher');
        const fetched = await fetchArticleContent(item.metadata.link, {
          sanitize: true,
          keepImages: true,
        });
        articleContent = fetched.content;
        console.log('[ArticleManager] Fetched full article, length:', articleContent.length);
      } catch (fetchError) {
        console.warn('[ArticleManager] Could not fetch full article, using available content:', fetchError);
        // Continue with available content
      }
    }
    
    // Get app service
    const appService = await envConfig.getAppService();
    
    // Create EPUB content using the HtmlToEpubConverter
    const { HtmlToEpubConverter } = await import('@/utils/htmlToEpub');
    const converter = new HtmlToEpubConverter();
    
    const { file: epubFile } = await converter.convert(articleContent, {
      title,
      author: author || 'Unknown',
      publishedTime: pubDate,
      siteName: item.metadata.fetchedContent?.siteName || item.metadata.journal,
      url: item.metadata.link,
    });
    
    // Load existing library books first
    const { loadLibraryBooks } = await import('@/services/libraryService');
    const books = await loadLibraryBooks(appService.fs, appService.generateCoverImageUrl.bind(appService));
    
    console.log('[ArticleManager] Importing article as book:', title, '- Existing books in library:', books.length);
    
    try {
      const importedBook = await appService.importBook(
        epubFile,
        books,
        true,  // saveBook
        false, // saveCover (articles don't have covers)
        false, // overwrite
        false  // transient
      );
      
      if (importedBook) {
        console.log('[ArticleManager] Book imported successfully:', importedBook);
        
        // Save the library books to library.json
        const { saveLibraryBooks } = await import('@/services/libraryService');
        await saveLibraryBooks(appService.fs, books);
        console.log('[ArticleManager] Library saved to disk');
        
        // Set article books to use scrolled mode by default
        const { saveBookConfig } = await import('@/services/bookService');
        const { DEFAULT_BOOK_SEARCH_CONFIG } = await import('@/services/constants');
        
        const articleConfig = {
          updatedAt: Date.now(),
          bookHash: importedBook.hash,
          viewSettings: {
            scrolled: true,  // Enable scrolled mode for articles
            noContinuousScroll: false,  // Allow continuous scrolling
          },
          searchConfig: DEFAULT_BOOK_SEARCH_CONFIG,
        };
        
        await saveBookConfig(appService.fs, importedBook, articleConfig, settings);
        console.log('[ArticleManager] Article configured for scrolled reading');
        
        // Update article state with book hash
        const currentState = settings.articleManagement?.articleStates?.[guid] || {
          guid,
          feedId: _feedId,
        };
        
        const newState = {
          ...currentState,
          savedAt: Date.now(),
          bookHash: importedBook.hash,
          deletedAt: undefined,
        };
        
        const newArticleStates = {
          ...settings.articleManagement?.articleStates,
          [guid]: newState,
        };
        
        const newArticleManagement = {
          ...settings.articleManagement,
          articleStates: newArticleStates,
        };
        
        // Save to disk first
        await saveSysSettings(envConfig, 'articleManagement', newArticleManagement);
        
        // Then update Zustand
        setSettings({
          ...settings,
          articleManagement: newArticleManagement,
        });
        
        console.log('[ArticleManager] Article saved to library:', importedBook.title);
      } else {
        throw new Error('Failed to import book - returned null');
      }
    } catch (importError) {
      console.error('[ArticleManager] Import error:', importError);
      throw importError;
    }
  } catch (error) {
    console.error('[ArticleManager] Failed to save article:', error);
    throw error;
  }
};

/**
 * Get all bookmarked articles
 */
export const getBookmarkedArticles = (items: RSSItem[]): RSSItem[] => {
  return items.filter((item) => {
    const guid = generateArticleGuid(item);
    const state = getArticleState(guid);
    return state?.bookmarkedAt !== undefined;
  });
};

/**
 * Get all saved articles
 */
export const getSavedArticles = (items: RSSItem[]): RSSItem[] => {
  return items.filter((item) => {
    const guid = generateArticleGuid(item);
    const state = getArticleState(guid);
    return state?.savedAt !== undefined;
  });
};

/**
 * Get all deleted articles (deprecated - always returns empty array)
 */
export const getDeletedArticles = (_items: RSSItem[]): RSSItem[] => {
  // Deletion is now immediate, so this always returns empty
  return [];
};

/**
 * Check if article is bookmarked
 */
export const isBookmarked = (item: RSSItem): boolean => {
  const guid = generateArticleGuid(item);
  const state = getArticleState(guid);
  return state?.bookmarkedAt !== undefined;
};

/**
 * Check if article is saved to library
 */
export const isSaved = (item: RSSItem): boolean => {
  const guid = generateArticleGuid(item);
  const state = getArticleState(guid);
  return state?.savedAt !== undefined;
};

/**
 * Check if article is marked for deletion (deprecated - always returns false)
 */
export const isDeleted = (item: RSSItem): boolean => {
  // Deletion is now immediate, so this always returns false
  return false;
};

/**
 * Run auto-cleanup on articles
 * Deletes articles older than cleanupAfterDays (excluding bookmarked/saved)
 */
export const runAutoCleanup = async (
  _items: RSSItem[]
): Promise<number> => {
  // TODO: Implement auto-cleanup logic
  console.log('[ArticleManager] Auto-cleanup not yet implemented');
  return 0;
};

/**
 * Apply article states to feed items
 * Called after fetching a feed to restore saved states
 */
export const applyArticleStates = (items: RSSItem[], feedId: string): void => {
  items.forEach((item) => {
    const guid = generateArticleGuid(item);
    const state = getArticleState(guid);
    
    if (state) {
      item.state = { ...state };
    } else {
      // Initialize state for new articles
      item.state = {
        guid,
        feedId,
      };
    }
  });
};
