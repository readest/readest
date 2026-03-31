'use client';

import { useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { RSSCatalog, RSSFeed, RSSItem } from '@/types/rss';
import { fetchRSSFeed } from '@/services/rss/rssFetcher';
import { applyArticleStates, getBookmarkedArticles, deleteArticle, isBookmarked, isSaved } from '@/services/rss/articleManager';
import { FeedView } from '@/app/rss/components/FeedView';
import { ItemView } from '@/app/rss/components/ItemView';
import { EditFeedDialog } from '@/app/rss/components/EditFeedDialog';
import { EditFolderDialog } from '@/app/library/components/EditFolderDialog';
import { FolderTree } from '@/app/library/components/FolderTree';
import { RSSManagerDialog } from '@/app/library/components/RSSManagerDialog';
import { CreateFolderDialog } from '@/app/library/components/CreateFolderDialog';
import { FiSearch, FiInbox, FiPlus, FiFolder, FiBookmark, FiX, FiSquare, FiTrash2, FiSave } from 'react-icons/fi';
import environmentConfig from '@/services/environment';
import { saveSysSettings } from '@/helpers/settings';
import { eventDispatcher } from '@/utils/event';

type FeedsViewMode = 'feed-list' | 'all-feeds' | 'articles' | 'article' | 'bookmarked';

interface FeedsViewProps {
  onNavigateToLibrary?: () => void;
}

export function FeedsView({}: FeedsViewProps) {
  const _ = useTranslation();
  const { settings, setSettings } = useSettingsStore();
  const [viewMode, setViewMode] = useState<FeedsViewMode>('all-feeds');
  const [selectedFeed, setSelectedFeed] = useState<RSSCatalog | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<RSSItem | null>(null);
  const [feed, setFeed] = useState<RSSFeed | null>(null);
  const [allFeedsData, setAllFeedsData] = useState<{catalog: RSSCatalog, feed: RSSFeed}[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingFeed, setEditingFeed] = useState<RSSCatalog | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [showRSSManager, setShowRSSManager] = useState(false);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [createFolderParent, setCreateFolderParent] = useState('');
  const [moveFeedId, setMoveFeedId] = useState<string | null>(null); // For click-to-move
  const [showMoveHint, setShowMoveHint] = useState(true); // Show move hint only once per session
  const [editingFolder, setEditingFolder] = useState<string | null>(null); // Folder path being edited
  const [editingFolderColor, setEditingFolderColor] = useState<string>('');

  // Collect all bookmarked articles from all loaded feeds
  const [allBookmarkedArticles, setAllBookmarkedArticles] = useState<RSSItem[]>([]);

  const userFeeds = settings.rssFeeds || [];
  const userFolders = settings.rssFolders || [];
  const folderColors = settings.rssFolderColors || {};

  console.log('[FeedsView] userFeeds on render:', userFeeds.map(f => ({ id: f.id, name: f.name, priority: f.priority, color: f.color })));
  console.log('[FeedsView] userFolders on render:', userFolders);
  console.log('[FeedsView] folderColors on render:', folderColors);

  const formatDate = (dateString?: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const extractPreviewText = (description?: string) => {
    if (!description) return '';
    // Remove HTML tags
    let plain = description.replace(/<[^>]*>/g, ' ');
    // Decode HTML entities
    plain = plain
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'");
    // Remove extra whitespace
    plain = plain.replace(/\s+/g, ' ').trim();
    // Truncate
    return plain.length > 200 ? plain.slice(0, 200) + '...' : plain;
  };

  const handleClearBookmarkedCache = () => {
    setAllBookmarkedArticles([]);
  };

  // Update bookmarked articles when feed changes
  const updateBookmarkedArticles = (newFeed: RSSFeed | null) => {
    if (newFeed?.items) {
      const bookmarked = getBookmarkedArticles(newFeed.items);
      setAllBookmarkedArticles(prev => {
        // Merge with existing, avoiding duplicates by GUID
        const existingGuids = new Set(prev.map(item => item.metadata.guid || item.metadata.title));
        const newItems = bookmarked.filter(item => !existingGuids.has(item.metadata.guid || item.metadata.title));
        return [...prev, ...newItems];
      });
    }
  };

  const loadFeed = async (catalog: RSSCatalog) => {
    try {
      const fetchedFeed = await fetchRSSFeed(catalog.url, catalog.fileContent);
      // Apply saved article states to the fetched items
      applyArticleStates(fetchedFeed.items, catalog.id);
      setFeed(fetchedFeed);
      setSelectedFeed(catalog);
      setSelectedFolder(null);
      setViewMode('articles');
      updateBookmarkedArticles(fetchedFeed);
    } catch (e) {
      console.error('Failed to load RSS feed:', e);
      eventDispatcher.dispatch('toast', {
        message: _('Failed to load feed: ') + (e as Error).message,
        timeout: 5000,
        type: 'error',
      });
    }
  };

  const loadAllFeeds = async () => {
    try {
      const feedPromises = userFeeds.map(async (catalog) => {
        try {
          const fetchedFeed = await fetchRSSFeed(catalog.url, catalog.fileContent);
          applyArticleStates(fetchedFeed.items, catalog.id);
          return { catalog, feed: fetchedFeed };
        } catch (e) {
          console.error(`Failed to load feed ${catalog.name}:`, e);
          return null;
        }
      });

      const results = await Promise.all(feedPromises);
      const validResults = results.filter((r): r is {catalog: RSSCatalog, feed: RSSFeed} => r !== null);
      
      setAllFeedsData(validResults);
      setSelectedFeed(null);
      setSelectedFolder(null);
      setViewMode('all-feeds');
    } catch (e) {
      console.error('Failed to load all feeds:', e);
      eventDispatcher.dispatch('toast', {
        message: _('Failed to load feeds: ') + (e as Error).message,
        timeout: 5000,
        type: 'error',
      });
    }
  };

  const loadFolderFeeds = async (folderPath: string) => {
    try {
      const folderFeeds = userFeeds.filter(f => f.folder === folderPath || f.folder?.startsWith(folderPath + '/'));
      
      const feedPromises = folderFeeds.map(async (catalog) => {
        try {
          const fetchedFeed = await fetchRSSFeed(catalog.url, catalog.fileContent);
          applyArticleStates(fetchedFeed.items, catalog.id);
          return { catalog, feed: fetchedFeed };
        } catch (e) {
          console.error(`Failed to load feed ${catalog.name}:`, e);
          return null;
        }
      });

      const results = await Promise.all(feedPromises);
      const validResults = results.filter((r): r is {catalog: RSSCatalog, feed: RSSFeed} => r !== null);
      
      setAllFeedsData(validResults);
      setSelectedFeed(null);
      setSelectedFolder(folderPath);
      setViewMode('all-feeds');
    } catch (e) {
      console.error('Failed to load folder feeds:', e);
      eventDispatcher.dispatch('toast', {
        message: _('Failed to load feeds: ') + (e as Error).message,
        timeout: 5000,
        type: 'error',
      });
    }
  };

  // Sort articles: priority feeds first, then by date (newest first)
  const sortArticles = (items: RSSItem[]): RSSItem[] => {
    return [...items].sort((a, b) => {
      // Find catalogs for both articles
      const catalogA = allFeedsData.find(({ feed }) => 
        feed.items.some(i => (i.metadata.guid || i.metadata.title) === (a.metadata.guid || a.metadata.title))
      )?.catalog;
      const catalogB = allFeedsData.find(({ feed }) => 
        feed.items.some(i => (i.metadata.guid || i.metadata.title) === (b.metadata.guid || b.metadata.title))
      )?.catalog;
      
      // Priority feeds first
      const aPriority = catalogA?.priority ? 1 : 0;
      const bPriority = catalogB?.priority ? 1 : 0;
      if (aPriority !== bPriority) return bPriority - aPriority;
      
      // Then by date (newest first)
      const aDate = a.metadata.pubDate ? new Date(a.metadata.pubDate).getTime() : 0;
      const bDate = b.metadata.pubDate ? new Date(b.metadata.pubDate).getTime() : 0;
      return bDate - aDate;
    });
  };

  const handleItemSelect = (item: RSSItem) => {
    setSelectedItem(item);
    setViewMode('article');
  };

  const handleBackToFeeds = () => {
    setSelectedItem(null);
    setViewMode('feed-list');
  };
  
  const handleViewBookmarked = () => {
    setViewMode('bookmarked');
  };

  const handleToggleSelectMode = () => {
    setSelectMode(!selectMode);
    setSelectedItems(new Set());
  };

  const handleToggleSelectItem = (guid: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(guid)) {
        next.delete(guid);
      } else {
        next.add(guid);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    let allGuids: string[] = [];
    if (viewMode === 'all-feeds') {
      allGuids = allFeedsData.flatMap(({ feed }) => 
        feed.items.map(item => item.metadata.guid || item.metadata.title)
      );
    } else if (feed?.items) {
      allGuids = feed.items.map(item => item.metadata.guid || item.metadata.title);
    } else if (allBookmarkedArticles.length > 0) {
      allGuids = allBookmarkedArticles.map(item => item.metadata.guid || item.metadata.title);
    }
    setSelectedItems(new Set(allGuids));
  };

  const handleSelectNone = () => {
    setSelectedItems(new Set());
  };

  const handleBulkDelete = async () => {
    if (selectedItems.size === 0) return;

    const count = selectedItems.size;
    const confirmed = window.confirm(`Delete ${count} selected article(s)? This cannot be undone.`);
    if (!confirmed) return;

    // Get all items to delete from current view
    let itemsToDelete: RSSItem[] = [];
    
    if (viewMode === 'all-feeds') {
      itemsToDelete = allFeedsData.flatMap(({ feed }) => 
        feed.items.filter(item => {
          const guid = item.metadata.guid || item.metadata.title;
          return selectedItems.has(guid);
        })
      );
    } else if (feed?.items) {
      itemsToDelete = feed.items.filter(item => {
        const guid = item.metadata.guid || item.metadata.title;
        return selectedItems.has(guid);
      });
    } else if (allBookmarkedArticles.length > 0) {
      itemsToDelete = allBookmarkedArticles.filter(item => {
        const guid = item.metadata.guid || item.metadata.title;
        return selectedItems.has(guid);
      });
    }

    for (const item of itemsToDelete) {
      await deleteArticle(item);
    }

    // Clear selection and refresh
    setSelectedItems(new Set());
    setSelectMode(false);

    // Reload the current view
    if (selectedFeed) {
      loadFeed(selectedFeed);
    } else if (selectedFolder) {
      loadFolderFeeds(selectedFolder);
    } else if (viewMode === 'all-feeds') {
      loadAllFeeds();
    }

    eventDispatcher.dispatch('toast', {
      message: `Deleted ${count} article(s)`,
      timeout: 3000,
      type: 'success',
    });
  };

  const handleImport = async (item: RSSItem) => {
    if (item.metadata.link) {
      window.open(item.metadata.link, '_blank');
    }
  };

  const handleEditFeed = (feedToEdit: RSSCatalog) => {
    setEditingFeed(feedToEdit);
  };

  const handleSaveFeed = async (updatedFeed: RSSCatalog) => {
    // Get latest settings from store to avoid stale state
    const currentSettings = useSettingsStore.getState().settings;
    const currentFeeds = currentSettings.rssFeeds || [];
    const updatedFeeds = currentFeeds.map((f) =>
      f.id === updatedFeed.id ? updatedFeed : f
    );
    // saveSysSettings handles both Zustand update and disk save
    await saveSysSettings(environmentConfig, 'rssFeeds', updatedFeeds);
    setEditingFeed(null);
    eventDispatcher.dispatch('toast', {
      message: _('Feed updated successfully'),
      timeout: 3000,
      type: 'success',
    });
  };

  const handleDeleteFeed = async (feedId: string) => {
    // Get latest settings from store to avoid stale state
    const currentSettings = useSettingsStore.getState().settings;
    const currentFeeds = currentSettings.rssFeeds || [];
    const updatedFeeds = currentFeeds.filter((f) => f.id !== feedId);
    // Save to disk FIRST
    await saveSysSettings(environmentConfig, 'rssFeeds', updatedFeeds);
    if (selectedFeed?.id === feedId) {
      setSelectedFeed(null);
      setFeed(null);
      setViewMode('feed-list');
    }
    eventDispatcher.dispatch('toast', {
      message: _('Feed deleted'),
      timeout: 3000,
      type: 'success',
    });
  };

  const handleAddFolder = (parentPath: string) => {
    setCreateFolderParent(parentPath);
    setShowCreateFolder(true);
  };

  const handleCreateFolder = async (newFolderPath: string) => {
    // Get latest settings from store
    const currentSettings = useSettingsStore.getState().settings;
    const currentFolders = currentSettings.rssFolders || [];

    // Check if folder already exists
    if (currentFolders.includes(newFolderPath)) {
      eventDispatcher.dispatch('toast', {
        message: _('Folder already exists'),
        timeout: 3000,
        type: 'error',
      });
      setShowCreateFolder(false);
      setCreateFolderParent('');
      return;
    }

    const updatedFolders = [...currentFolders, newFolderPath];
    await saveSysSettings(environmentConfig, 'rssFolders', updatedFolders);

    const folderName = newFolderPath.split('/').pop() || newFolderPath;
    eventDispatcher.dispatch('toast', {
      message: `Folder "${folderName}" created`,
      timeout: 3000,
      type: 'success',
    });

    setShowCreateFolder(false);
    setCreateFolderParent('');
  };

  const handleMoveFeed = async (feedId: string, newFolder: string) => {
    // Get latest settings from store
    const currentSettings = useSettingsStore.getState().settings;
    const currentFeeds = currentSettings.rssFeeds || [];
    
    // Update the feed's folder
    const updatedFeeds = currentFeeds.map(f =>
      f.id === feedId ? { ...f, folder: newFolder || undefined } : f
    );
    
    await saveSysSettings(environmentConfig, 'rssFeeds', updatedFeeds);
    
    const feed = updatedFeeds.find(f => f.id === feedId);
    eventDispatcher.dispatch('toast', {
      message: `Moved "${feed?.name}" to ${newFolder || 'Uncategorized'}`,
      timeout: 3000,
      type: 'success',
    });
    
    setMoveFeedId(null);
    
    // Refresh current view if needed
    if (selectedFeed) {
      loadFeed(selectedFeed);
    }
  };

  const handleStartMoveFeed = (feedId: string) => {
    setMoveFeedId(feedId);
    // Only show hint once per session
    if (showMoveHint) {
      eventDispatcher.dispatch('toast', {
        message: 'Click on a folder to move this feed there, or press Escape to cancel',
        timeout: 5000,
        type: 'info',
      });
      setShowMoveHint(false);
    }
  };

  const handleDeleteFolder = async (folderPath: string) => {
    // Get latest settings from store
    const currentSettings = useSettingsStore.getState().settings;
    const currentFolders = currentSettings.rssFolders || [];
    const currentFeeds = currentSettings.rssFeeds || [];
    
    // Move feeds in this folder to Uncategorized
    const updatedFeeds = currentFeeds.map(f => {
      if (f.folder === folderPath || f.folder?.startsWith(folderPath + '/')) {
        return { ...f, folder: undefined };
      }
      return f;
    });
    
    // Remove the folder and all subfolders
    const updatedFolders = currentFolders.filter(f => 
      f !== folderPath && !f.startsWith(folderPath + '/')
    );
    
    await saveSysSettings(environmentConfig, 'rssFeeds', updatedFeeds);
    await saveSysSettings(environmentConfig, 'rssFolders', updatedFolders);
    
    eventDispatcher.dispatch('toast', {
      message: `Folder "${folderPath}" deleted`,
      timeout: 3000,
      type: 'success',
    });
    
    // Refresh current view
    if (selectedFeed) {
      loadFeed(selectedFeed);
    }
  };

  const handleEditFolder = (folderPath: string) => {
    setEditingFolder(folderPath);
    // Get folder color from settings (if stored)
    const currentSettings = useSettingsStore.getState().settings;
    const folderColors = (currentSettings as any).rssFolderColors || {};
    setEditingFolderColor(folderColors[folderPath] || '');
  };

  const handleSaveFolder = async (folderPath: string, newName: string, newColor: string) => {
    const currentSettings = useSettingsStore.getState().settings;
    const currentFolders = currentSettings.rssFolders || [];
    
    // Rename folder: remove old path, add new path
    const folderParts = folderPath.split('/');
    folderParts[folderParts.length - 1] = newName;
    const newPath = folderParts.join('/');
    
    // Update folders list
    let updatedFolders = currentFolders.filter(f => f !== folderPath && !f.startsWith(folderPath + '/'));
    // Add renamed folder and update subfolders
    currentFolders.forEach(f => {
      if (f === folderPath) {
        updatedFolders.push(newPath);
      } else if (f.startsWith(folderPath + '/')) {
        updatedFolders.push(f.replace(folderPath + '/', newPath + '/'));
      }
    });
    
    // Update feeds in this folder
    const currentFeeds = currentSettings.rssFeeds || [];
    const updatedFeeds = currentFeeds.map(f => {
      if (f.folder === folderPath) {
        return { ...f, folder: newPath };
      } else if (f.folder?.startsWith(folderPath + '/')) {
        return { ...f, folder: f.folder.replace(folderPath + '/', newPath + '/') };
      }
      return f;
    });
    
    // Save folder colors
    const folderColors = { ...currentSettings.rssFolderColors || {} };
    if (folderColors[folderPath]) {
      folderColors[newPath] = newColor;
      delete folderColors[folderPath];
    } else if (newColor) {
      folderColors[newPath] = newColor;
    }

    // Update settings with all changes and save together
    const newSettings = {
      ...useSettingsStore.getState().settings,
      rssFeeds: updatedFeeds,
      rssFolders: updatedFolders,
      rssFolderColors: folderColors,
    };
    
    // Update Zustand
    setSettings(newSettings);
    
    // Save all settings to disk in one call to avoid race conditions
    const appService = await environmentConfig.getAppService();
    await appService.saveSettings(newSettings);
    
    console.log('[handleSaveFolder] Saved folder colors:', folderColors);

    setEditingFolder(null);
    eventDispatcher.dispatch('toast', {
      message: `Folder renamed to "${newName}"`,
      timeout: 3000,
      type: 'success',
    });

    if (selectedFeed) {
      loadFeed(selectedFeed);
    }
  };

  // Filter articles by search (title, tags, subjects)
  const filterArticles = (items: RSSItem[]) => {
    if (!searchQuery) return items;
    
    const query = searchQuery.toLowerCase();
    return items.filter(item => {
      // Search in title
      if (item.metadata.title.toLowerCase().includes(query)) {
        return true;
      }
      // Search in subjects
      if (item.metadata.subject?.some(s => s.toLowerCase().includes(query))) {
        return true;
      }
      // Search in description
      if (item.metadata.description?.toLowerCase().includes(query)) {
        return true;
      }
      // Search in author
      if (item.metadata.author?.toLowerCase().includes(query)) {
        return true;
      }
      return false;
    });
  };

  // Get all articles from current view for filtering
  const getAllArticlesForView = (): RSSItem[] => {
    let items: RSSItem[] = [];
    if (viewMode === 'all-feeds') {
      items = allFeedsData.flatMap(({ feed }) => feed.items);
      // Sort: priority feeds first, then by date
      return sortArticles(items);
    } else if (feed?.items) {
      return feed.items;
    } else if (viewMode === 'bookmarked') {
      return allBookmarkedArticles;
    }
    return items;
  };

  const displayedItems = filterArticles(getAllArticlesForView());

  // Get existing folder paths for duplicate checking
  const existingFolders = new Set<string>(userFeeds.map(f => f.folder).filter((f): f is string => Boolean(f)));

  return (
    <div className="flex h-full">
      {/* Feed List Sidebar */}
      <div className="bg-base-200 w-80 flex-shrink-0 overflow-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
        {/* Header */}
        <div className="flex items-center justify-between border-b p-4">
          <h2 className="text-lg font-bold">{_('My Feeds')}</h2>
          <div className="flex gap-1">
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setCreateFolderParent('');
                setShowCreateFolder(true);
              }}
              title={_('Create Folder')}
            >
              <FiFolder size={16} />
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={handleViewBookmarked}
              title={_('Bookmarked Articles')}
            >
              <FiBookmark size={16} />
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={loadAllFeeds}
              title={_('All Feeds')}
            >
              <FiInbox size={18} />
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setShowRSSManager(true)}
              title={_('Import Feed')}
            >
              <FiPlus size={18} />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="p-3">
          <div className="relative">
            <FiSearch className="text-base-content/50 absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
            <input
              type="text"
              className="input input-bordered input-sm w-full pl-10"
              placeholder={_('Search (title, subject, tags)...')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Folder Tree */}
        <FolderTree
          feeds={userFeeds}
          folders={userFolders}
          folderColors={folderColors}
          selectedFeed={selectedFeed}
          moveFeedId={moveFeedId}
          onFeedSelect={loadFeed}
          onFolderSelect={loadFolderFeeds}
          onEditFeed={handleEditFeed}
          onDeleteFeed={handleDeleteFeed}
          onTogglePriority={async (feedId) => {
            // Get latest settings from store to avoid stale state
            const currentSettings = useSettingsStore.getState().settings;
            const currentFeeds = currentSettings.rssFeeds || [];
            const feedToToggle = currentFeeds.find(f => f.id === feedId);
            console.log('[TogglePriority] Before:', feedToToggle?.priority, 'Feed:', feedToToggle);
            const updatedFeeds = currentFeeds.map(f =>
              f.id === feedId ? { ...f, priority: !f.priority } : f
            );
            const updatedFeed = updatedFeeds.find(f => f.id === feedId);
            console.log('[TogglePriority] After:', updatedFeed?.priority, 'Feed:', updatedFeed);
            console.log('[TogglePriority] All feeds:', updatedFeeds.map(f => ({ id: f.id, name: f.name, priority: f.priority })));
            // saveSysSettings handles both Zustand update and disk save
            await saveSysSettings(environmentConfig, 'rssFeeds', updatedFeeds);
            console.log('[TogglePriority] Save completed, verifying...');
            // Verify the save
            const verifySettings = useSettingsStore.getState().settings;
            const verifyFeed = verifySettings.rssFeeds?.find(f => f.id === feedId);
            console.log('[TogglePriority] Verified in store:', verifyFeed?.priority);
          }}
          onAddFolder={handleAddFolder}
          onDeleteFolder={handleDeleteFolder}
          onEditFolder={handleEditFolder}
          onMoveFeed={handleMoveFeed}
          onStartMoveFeed={handleStartMoveFeed}
          onCancelMoveFeed={() => setMoveFeedId(null)}
        />
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-auto">
        {viewMode === 'all-feeds' && (
          <div className="h-full overflow-auto">
            {/* Header with selection controls */}
            <div className="border-base-300 sticky top-0 z-10 flex flex-col border-b bg-base-100">
              <div className="flex items-center justify-between px-6 py-3">
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold">
                    {selectedFolder ? `${selectedFolder} Feeds` : _('All Feeds')}
                  </h2>
                  {selectedFolder && (
                    <button
                      className="btn btn-ghost btn-xs"
                      onClick={loadAllFeeds}
                    >
                      <FiX size={14} />
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {selectMode ? (
                    <>
                      <span className="text-sm text-base-content/70">
                        {selectedItems.size} selected
                      </span>
                      <button
                        className="btn btn-ghost btn-xs"
                        onClick={handleSelectAll}
                        title={_('Select All')}
                      >
                        All
                      </button>
                      <button
                        className="btn btn-ghost btn-xs"
                        onClick={handleSelectNone}
                        title={_('Select None')}
                      >
                        None
                      </button>
                      <button
                        className="btn btn-error btn-sm"
                        onClick={handleBulkDelete}
                        disabled={selectedItems.size === 0}
                      >
                        <FiTrash2 className="mr-1 h-4 w-4" />
                        Delete ({selectedItems.size})
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={handleToggleSelectMode}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={handleToggleSelectMode}
                      title={_('Select Multiple Articles')}
                    >
                      <FiSquare size={18} />
                    </button>
                  )}
                </div>
              </div>
              {/* Bulk delete toolbar (appears when items selected) */}
              {selectMode && selectedItems.size > 0 && (
                <div className="bg-primary/10 px-6 py-2 text-sm">
                  <span className="text-primary">
                    {selectedItems.size} article(s) selected for deletion
                  </span>
                </div>
              )}
            </div>
            
            {/* Render interspersed articles */}
            {displayedItems.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <div className="text-center">
                  <FiInbox className="mx-auto mb-4 h-16 w-16" />
                  <h3 className="text-lg font-semibold">{selectedFolder ? _('No articles in this folder') : _('No feeds configured')}</h3>
                  <p className="text-sm">{selectedFolder ? _('Add feeds to this folder to see articles here') : _('Add RSS feeds to see articles here')}</p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col">
                {displayedItems.map((item, index) => {
                  const guid = item.metadata.guid || item.metadata.title || String(index);
                  const isSelected = selectedItems.has(guid);
                  const bookmarked = isBookmarked(item);
                  const saved = isSaved(item);

                  // Find the feed catalog for this article
                  const feedCatalog = allFeedsData.find(({ feed }) =>
                    feed.items.some(i => (i.metadata.guid || i.metadata.title) === guid)
                  )?.catalog;

                  return (
                    <div
                      key={guid}
                      className={`card transition-colors mx-4 my-2 ${
                        isSelected
                          ? 'bg-primary/10 border-2 border-primary'
                          : bookmarked
                            ? 'border-2 border-warning'
                            : saved
                              ? 'border-2 border-success'
                              : 'bg-base-200 hover:bg-base-300'
                      }`}
                      onClick={() => !selectMode && handleItemSelect(item)}
                    >
                      <div className="card-body p-4">
                        <div className="flex items-start gap-4">
                          {/* Checkbox for selection mode */}
                          {selectMode && (
                            <div className="flex-shrink-0 pt-1">
                              <input
                                type="checkbox"
                                className="checkbox checkbox-sm"
                                checked={isSelected}
                                onChange={() => handleToggleSelectItem(guid)}
                                onClick={(e) => e.stopPropagation()}
                              />
                            </div>
                          )}

                          <div className="flex-1">
                            <div className="flex items-center gap-2 flex-wrap" onClick={() => selectMode && handleToggleSelectItem(guid)}>
                              {/* Publisher/source pill */}
                              {feedCatalog && (
                                <span 
                                  className="badge badge-sm flex-shrink-0 text-white"
                                  style={{ backgroundColor: feedCatalog.color || '#3b82f6' }}
                                >
                                  {feedCatalog.name}
                                  {feedCatalog.priority && (
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 ml-1" viewBox="0 0 20 20" fill="currentColor">
                                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                                    </svg>
                                  )}
                                </span>
                              )}
                              <h3 className="text-lg font-semibold">{item.metadata.title}</h3>
                              {bookmarked && (
                                <span className="text-warning" title={_('Bookmarked')}>
                                  <FiBookmark className="h-4 w-4" />
                                </span>
                              )}
                              {saved && (
                                <span className="text-success" title={_('Saved to Library')}>
                                  <FiSave className="h-4 w-4" />
                                </span>
                              )}
                            </div>

                            <div className="text-base-content/70 mt-1 flex flex-wrap items-center gap-2 text-sm">
                              {item.metadata.author && (
                                <span>{item.metadata.author}</span>
                              )}
                              {item.metadata.pubDate && (
                                <>
                                  <span>•</span>
                                  <time>{formatDate(item.metadata.pubDate)}</time>
                                </>
                              )}
                              {item.metadata.doi && (
                                <>
                                  <span>•</span>
                                  <span className="badge badge-primary badge-sm">DOI</span>
                                </>
                              )}
                            </div>

                            {item.metadata.description && (
                              <p className="text-base-content/70 mt-2 line-clamp-2 text-sm">
                                {extractPreviewText(item.metadata.description)}
                              </p>
                            )}

                            {item.metadata.subject && item.metadata.subject.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-3">
                                {item.metadata.subject.slice(0, 5).map((subject, idx) => (
                                  <span key={idx} className="badge badge-ghost badge-xs">
                                    {subject}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {viewMode === 'articles' && feed && selectedFeed && (
          <div className="h-full overflow-auto">
            {/* Header with selection controls */}
            <div className="border-base-300 sticky top-0 z-10 flex flex-col border-b bg-base-100">
              {/* Top bar */}
              <div className="flex items-center justify-between px-6 py-3">
                <div className="flex items-center gap-2">
                  <button className="btn btn-ghost btn-sm" onClick={handleBackToFeeds}>
                    ←
                  </button>
                  <h2 className="font-semibold">{selectedFeed.name}</h2>
                  {selectedFeed.folder && (
                    <span className="badge badge-ghost badge-sm">
                      <FiFolder className="mr-1 h-3 w-3" />
                      {selectedFeed.folder}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {selectMode ? (
                    <>
                      <span className="text-sm text-base-content/70">
                        {selectedItems.size} selected
                      </span>
                      <button
                        className="btn btn-ghost btn-xs"
                        onClick={handleSelectAll}
                        title={_('Select All')}
                      >
                        All
                      </button>
                      <button
                        className="btn btn-ghost btn-xs"
                        onClick={handleSelectNone}
                        title={_('Select None')}
                      >
                        None
                      </button>
                      <button
                        className="btn btn-error btn-sm"
                        onClick={handleBulkDelete}
                        disabled={selectedItems.size === 0}
                      >
                        <FiTrash2 className="mr-1 h-4 w-4" />
                        Delete ({selectedItems.size})
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={handleToggleSelectMode}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={handleToggleSelectMode}
                      title={_('Select Multiple Articles')}
                    >
                      <FiSquare size={18} />
                    </button>
                  )}
                </div>
              </div>
              {/* Bulk delete toolbar (appears when items selected) */}
              {selectMode && selectedItems.size > 0 && (
                <div className="bg-primary/10 px-6 py-2 text-sm">
                  <span className="text-primary">
                    {selectedItems.size} article(s) selected for deletion
                  </span>
                </div>
              )}
            </div>
            <FeedView
              feed={{ ...feed, items: filterArticles(feed.items) }}
              onItemSelect={handleItemSelect}
              onSelectMode={selectMode}
              selectedItems={selectedItems}
              onToggleSelect={handleToggleSelectItem}
            />
          </div>
        )}
        
        {viewMode === 'bookmarked' && (
          <div className="h-full overflow-auto">
            {/* Header with selection controls */}
            <div className="border-base-300 sticky top-0 z-10 flex flex-col border-b bg-base-100">
              <div className="flex items-center justify-between px-6 py-3">
                <div className="flex items-center gap-2">
                  <button className="btn btn-ghost btn-sm" onClick={handleBackToFeeds}>
                    ←
                  </button>
                  <h2 className="font-semibold">{_('Bookmarked Articles')}</h2>
                  <span className="badge badge-warning badge-sm">{allBookmarkedArticles.length}</span>
                </div>
                <div className="flex items-center gap-2">
                  {allBookmarkedArticles.length > 0 && (
                    <button
                      className="btn btn-ghost btn-xs"
                      onClick={handleClearBookmarkedCache}
                      title={_('Clear cache (articles will reload when feeds are visited)')}
                    >
                      <FiX size={14} />
                    </button>
                  )}
                  {allBookmarkedArticles.length > 0 && (
                    selectMode ? (
                      <>
                        <span className="text-sm text-base-content/70">
                          {selectedItems.size} selected
                        </span>
                        <button
                          className="btn btn-ghost btn-xs"
                          onClick={handleSelectAll}
                        >
                          All
                        </button>
                        <button
                          className="btn btn-ghost btn-xs"
                          onClick={handleSelectNone}
                        >
                          None
                        </button>
                        <button
                          className="btn btn-error btn-sm"
                          onClick={handleBulkDelete}
                          disabled={selectedItems.size === 0}
                        >
                          <FiTrash2 className="mr-1 h-4 w-4" />
                          Delete ({selectedItems.size})
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={handleToggleSelectMode}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={handleToggleSelectMode}
                        title={_('Select Multiple Articles')}
                      >
                        <FiSquare size={18} />
                      </button>
                    )
                  )}
                </div>
              </div>
              {selectMode && selectedItems.size > 0 && (
                <div className="bg-primary/10 px-6 py-2 text-sm">
                  <span className="text-primary">
                    {selectedItems.size} article(s) selected for deletion
                  </span>
                </div>
              )}
            </div>
            {allBookmarkedArticles.length > 0 ? (
              <FeedView
                feed={{
                  metadata: {},
                  links: [],
                  items: allBookmarkedArticles,
                }}
                onItemSelect={handleItemSelect}
                onSelectMode={selectMode}
                selectedItems={selectedItems}
                onToggleSelect={handleToggleSelectItem}
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <p className="text-base-content/70">{_('No bookmarked articles. Click the bookmark icon on articles to save them here!')}</p>
              </div>
            )}
          </div>
        )}

        {viewMode === 'article' && selectedItem && (
          <div className="h-full overflow-auto">
            <div className="border-base-300 sticky top-0 z-10 flex items-center gap-2 border-b bg-base-100 px-6 py-3">
              <button className="btn btn-ghost btn-sm" onClick={handleBackToFeeds}>
                ←
              </button>
              <h2 className="font-semibold">{selectedItem.metadata.title}</h2>
            </div>
            <ItemView item={selectedItem} onImport={handleImport} />
          </div>
        )}

        {viewMode === 'feed-list' && (
          <div className="flex h-full items-center justify-center text-base-content/60">
            <div className="text-center">
              <FiInbox className="mx-auto mb-4 h-16 w-16" />
              <h3 className="text-lg font-semibold">{_('Select a feed to view articles')}</h3>
              <p className="text-sm">{_('Or click the inbox icon to view all feeds')}</p>
              <button
                className="btn btn-primary btn-sm mt-4"
                onClick={loadAllFeeds}
              >
                View All Feeds
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Edit Feed Dialog */}
      {editingFeed && (
        <EditFeedDialog
          feed={editingFeed}
          onSave={handleSaveFeed}
          onClose={() => setEditingFeed(null)}
        />
      )}

      {/* RSS Manager Dialog */}
      {showRSSManager && (
        <RSSManagerDialog
          onClose={() => setShowRSSManager(false)}
        />
      )}

      {/* Create Folder Dialog */}
      {showCreateFolder && (
        <CreateFolderDialog
          parentPath={createFolderParent}
          existingFolders={existingFolders}
          onSave={handleCreateFolder}
          onClose={() => {
            setShowCreateFolder(false);
            setCreateFolderParent('');
          }}
        />
      )}

      {/* Edit Folder Dialog */}
      {editingFolder && (
        <EditFolderDialog
          folderPath={editingFolder}
          initialColor={editingFolderColor}
          onSave={(name, color) => handleSaveFolder(editingFolder, name, color)}
          onClose={() => setEditingFolder(null)}
        />
      )}
    </div>
  );
}
