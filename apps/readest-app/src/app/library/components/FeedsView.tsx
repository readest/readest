'use client';

import { useState, useEffect } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { RSSCatalog, RSSFeed, RSSItem } from '@/types/rss';
import { fetchRSSFeed } from '@/services/rss/rssFetcher';
import { FeedView } from '@/app/rss/components/FeedView';
import { ItemView } from '@/app/rss/components/ItemView';
import { EditFeedDialog } from '@/app/rss/components/EditFeedDialog';
import { FolderTree } from '@/app/library/components/FolderTree';
import { FiSearch, FiInbox, FiPlus } from 'react-icons/fi';
import { open } from '@tauri-apps/plugin-dialog';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { isTauriAppPlatform } from '@/services/environment';
import { saveSysSettings } from '@/helpers/settings';
import { eventDispatcher } from '@/utils/event';

type FeedsViewMode = 'feed-list' | 'articles' | 'article';

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

  const userFeeds = settings.rssFeeds || [];

  const loadFeed = async (catalog: RSSCatalog) => {
    setLoading(true);
    try {
      const fetchedFeed = await fetchRSSFeed(catalog.url, catalog.fileContent);
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
    setSettings({ ...settings, rssFeeds: updatedFeeds });
    await saveSysSettings(settings, 'rssFeeds', updatedFeeds);
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
          <button
            className="btn btn-ghost btn-sm"
            onClick={handleImportFile}
            title={_('Import Feed')}
          >
            <FiPlus size={18} />
          </button>
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
            <div className="border-base-300 sticky top-0 z-10 flex items-center gap-2 border-b bg-base-100 px-6 py-3">
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
            <FeedView
              feed={{ ...feed, items: filteredItems || feed.items }}
              onItemSelect={handleItemSelect}
            />
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
