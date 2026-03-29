'use client';

import { useState, useEffect } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { RSSCatalog, RSSFeed, RSSItem } from '@/types/rss';
import { fetchRSSFeed } from '@/services/rss/rssFetcher';
import { applyArticleStates, getBookmarkedArticles, deleteArticle } from '@/services/rss/articleManager';
import { FeedView } from '@/app/rss/components/FeedView';
import { ItemView } from '@/app/rss/components/ItemView';
import { EditFeedDialog } from '@/app/rss/components/EditFeedDialog';
import { FolderTree } from '@/app/library/components/FolderTree';
import { FiSearch, FiInbox, FiPlus, FiFolder, FiBookmark, FiX, FiSquare, FiTrash2 } from 'react-icons/fi';
import { open } from '@tauri-apps/plugin-dialog';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { isTauriAppPlatform } from '@/services/environment';
import environmentConfig from '@/services/environment';
import { saveSysSettings } from '@/helpers/settings';
import { eventDispatcher } from '@/utils/event';

type FeedsViewMode = 'feed-list' | 'articles' | 'article' | 'bookmarked';

interface FeedsViewProps {
  onNavigateToLibrary?: () => void;
}

export function FeedsView({ onNavigateToLibrary }: FeedsViewProps) {
  const _ = useTranslation();
  const { settings, setSettings } = useSettingsStore();
  const [viewMode, setViewMode] = useState<FeedsViewMode>('feed-list');
  const [selectedFeed, setSelectedFeed] = useState<RSSCatalog | null>(null);
  const [selectedItem, setSelectedItem] = useState<RSSItem | null>(null);
  const [feed, setFeed] = useState<RSSFeed | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [folderFilter, setFolderFilter] = useState<string | null>(null);
  const [editingFeed, setEditingFeed] = useState<RSSCatalog | null>(null);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

  const userFeeds = settings.rssFeeds || [];
  
  // Debug: Log feeds on render
  useEffect(() => {
    console.log('[FeedsView] Current feeds:', userFeeds.map(f => ({ id: f.id, name: f.name, category: f.category })));
  }, [userFeeds]);
  
  // Collect all bookmarked articles from all loaded feeds
  const [allBookmarkedArticles, setAllBookmarkedArticles] = useState<RSSItem[]>([]);
  
  useEffect(() => {
    if (feed?.items) {
      const bookmarked = getBookmarkedArticles(feed.items);
      setAllBookmarkedArticles(prev => {
        // Merge with existing, avoiding duplicates by GUID
        const existingGuids = new Set(prev.map(item => item.metadata.guid || item.metadata.title));
        const newItems = bookmarked.filter(item => !existingGuids.has(item.metadata.guid || item.metadata.title));
        return [...prev, ...newItems];
      });
    }
  }, [feed?.items]);
  
  const handleClearBookmarkedCache = () => {
    setAllBookmarkedArticles([]);
  };

  const loadFeed = async (catalog: RSSCatalog) => {
    try {
      const fetchedFeed = await fetchRSSFeed(catalog.url, catalog.fileContent);
      // Apply saved article states to the fetched items
      applyArticleStates(fetchedFeed.items, catalog.id);
      setFeed(fetchedFeed);
      setSelectedFeed(catalog);
      setViewMode('articles');
    } catch (e) {
      console.error('Failed to load RSS feed:', e);
      eventDispatcher.dispatch('toast', {
        message: _('Failed to load feed: ') + (e as Error).message,
        timeout: 5000,
        type: 'error',
      });
    } finally {
      setLoading(false);
    }
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
    if (feed?.items) {
      const allGuids = feed.items.map(item => item.metadata.guid || item.metadata.title);
      setSelectedItems(new Set(allGuids));
    }
  };

  const handleSelectNone = () => {
    setSelectedItems(new Set());
  };

  const handleBulkDelete = async () => {
    if (selectedItems.size === 0) return;
    
    const count = selectedItems.size;
    const confirmed = window.confirm(`Delete ${count} selected article(s)? This cannot be undone.`);
    if (!confirmed) return;
    
    // Delete all selected articles
    const itemsToDelete = feed?.items.filter(item => {
      const guid = item.metadata.guid || item.metadata.title;
      return selectedItems.has(guid);
    }) || [];
    
    for (const item of itemsToDelete) {
      await deleteArticle(item);
    }
    
    // Clear selection and refresh
    setSelectedItems(new Set());
    setSelectMode(false);
    
    // Reload the current feed to reflect deletions
    if (selectedFeed) {
      loadFeed(selectedFeed);
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
    const updatedFeeds = userFeeds.map((f) =>
      f.id === updatedFeed.id ? updatedFeed : f
    );
    setSettings({ ...settings, rssFeeds: updatedFeeds });
    await saveSysSettings(settings, 'rssFeeds', updatedFeeds);
    setEditingFeed(null);
    eventDispatcher.dispatch('toast', {
      message: _('Feed updated successfully'),
      timeout: 3000,
      type: 'success',
    });
  };

  const handleDeleteFeed = async (feedId: string) => {
    const updatedFeeds = userFeeds.filter((f) => f.id !== feedId);
    // Save to disk FIRST
    await saveSysSettings(environmentConfig, 'rssFeeds', updatedFeeds);
    // Then update Zustand
    setSettings({ ...settings, rssFeeds: updatedFeeds });
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

  const handleImportFile = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{
          name: 'RSS/OPML Files',
          extensions: ['opml', 'rss', 'xml'],
        }],
      });

      if (selected && typeof selected === 'string') {
        const fileContent = await readTextFile(selected);
        const fileName = selected.split('/').pop()?.split('\\').pop() || 'imported-feed';
        
        const newFeed: RSSCatalog = {
          id: `local-${Date.now()}`,
          name: fileName.replace(/\.(rss|xml|opml)$/i, ''),
          url: '',
          description: _('Imported from file'),
          icon: '📁',
          category: 'Local',
          isLocal: true,
          fileContent: fileContent,
        };

        const updatedFeeds = [...userFeeds, newFeed];
        setSettings({ ...settings, rssFeeds: updatedFeeds });
        await saveSysSettings(settings, 'rssFeeds', updatedFeeds);
        
        eventDispatcher.dispatch('toast', {
          message: _('Feed imported successfully'),
          timeout: 3000,
          type: 'success',
        });
      }
    } catch (e) {
      console.error('Failed to import feed:', e);
    }
  };

  // Filter articles by search
  const filteredItems = feed?.items.filter(item => {
    if (searchQuery && !item.metadata.title.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    return true;
  });

  return (
    <div className="flex h-full">
      {/* Feed List Sidebar */}
      <div className="bg-base-200 w-80 flex-shrink-0 overflow-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b p-4">
          <h2 className="text-lg font-bold">{_('My Feeds')}</h2>
          <div className="flex gap-1">
            <button
              className="btn btn-ghost btn-sm"
              onClick={handleViewBookmarked}
              title={_('Bookmarked Articles')}
            >
              <FiBookmark size={16} />
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={handleImportFile}
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
              placeholder={_('Search feeds...')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Folder Tree */}
        <FolderTree
          feeds={userFeeds}
          selectedFeed={selectedFeed}
          onFeedSelect={loadFeed}
          onEditFeed={handleEditFeed}
          onDeleteFeed={handleDeleteFeed}
        />
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-auto">
        {viewMode === 'loading' && (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <div className="loading loading-spinner loading-lg mb-4"></div>
              <h1 className="text-base font-semibold">{_('Loading...')}</h1>
            </div>
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
              feed={{ ...feed, items: filteredItems || feed.items }}
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
              <p className="text-sm">{_('Choose a feed from the list on the left')}</p>
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
    </div>
  );
}
