'use client';

import { useState, useEffect } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { RSSCatalog, RSSFeed, RSSItem } from '@/types/rss';
import { fetchRSSFeed } from '@/services/rss/rssFetcher';
import { FeedView } from '@/app/rss/components/FeedView';
import { ItemView } from '@/app/rss/components/ItemView';
import { RSSManager } from '@/app/rss/components/RSSManager';
import { FiRss, FiSettings, FiList, FiGrid } from 'react-icons/fi';

interface RSSPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

type RSSViewMode = 'manager' | 'feeds' | 'article';
type FeedDisplayMode = 'list' | 'grid';

export function RSSPanel({ isOpen, onClose }: RSSPanelProps) {
  const _ = useTranslation();
  const [viewMode, setViewMode] = useState<RSSViewMode>('manager');
  const [feedDisplayMode, setFeedDisplayMode] = useState<FeedDisplayMode>('list');
  const [selectedFeed, setSelectedFeed] = useState<RSSCatalog | null>(null);
  const [selectedItem, setSelectedItem] = useState<RSSItem | null>(null);
  const [feed, setFeed] = useState<RSSFeed | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [folderFilter, setFolderFilter] = useState<string | null>(null);

  const loadFeed = async (catalog: RSSCatalog) => {
    setLoading(true);
    try {
      const fetchedFeed = await fetchRSSFeed(catalog.url, catalog.fileContent);
      setFeed(fetchedFeed);
      setSelectedFeed(catalog);
      setViewMode('feeds');
    } catch (e) {
      console.error('Failed to load RSS feed:', e);
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
    setFeed(null);
    setViewMode('manager');
  };

  const handleBackToManager = () => {
    setSelectedFeed(null);
    setSelectedItem(null);
    setFeed(null);
    setViewMode('manager');
  };

  const handleImport = async (item: RSSItem) => {
    if (item.metadata.link) {
      window.open(item.metadata.link, '_blank');
    }
  };

  // Filter feeds by folder and search
  const filteredFeeds = selectedFeed?.feed?.items.filter(item => {
    if (searchQuery && !item.metadata.title.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    return true;
  });

  if (!isOpen) return null;

  return (
    <div className='bg-base-100 flex h-full flex-col border-l'>
      {/* Header */}
      <div className='border-base-200 flex items-center justify-between border-b px-4 py-3'>
        <div className='flex items-center gap-2'>
          <FiRss className='text-primary h-5 w-5' />
          <h2 className='text-lg font-bold'>{_('RSS Feeds')}</h2>
        </div>
        <div className='flex items-center gap-2'>
          {viewMode === 'feeds' && (
            <>
              <button
                className={`btn btn-ghost btn-sm ${feedDisplayMode === 'list' ? 'btn-active' : ''}`}
                onClick={() => setFeedDisplayMode('list')}
                title={_('List View')}
              >
                <FiList size={16} />
              </button>
              <button
                className={`btn btn-ghost btn-sm ${feedDisplayMode === 'grid' ? 'btn-active' : ''}`}
                onClick={() => setFeedDisplayMode('grid')}
                title={_('Grid View')}
              >
                <FiGrid size={16} />
              </button>
            </>
          )}
          <button
            className='btn btn-ghost btn-sm'
            onClick={handleBackToManager}
            title={_('Manage Feeds')}
          >
            <FiSettings size={18} />
          </button>
          <button className='btn btn-ghost btn-sm' onClick={onClose}>
            ✕
          </button>
        </div>
      </div>

      {/* Search Bar (when viewing feeds) */}
      {viewMode === 'feeds' && (
        <div className='border-base-200 border-b px-4 py-2'>
          <input
            type='text'
            className='input input-bordered input-sm w-full'
            placeholder={_('Search articles...')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      )}

      {/* Content */}
      <div className='flex-1 overflow-auto'>
        {viewMode === 'manager' && (
          <RSSManager onFeedSelect={loadFeed} onClose={onClose} />
        )}

        {viewMode === 'loading' && (
          <div className='flex h-full items-center justify-center'>
            <div className='text-center'>
              <div className='loading loading-spinner loading-lg mb-4'></div>
              <h1 className='text-base font-semibold'>{_('Loading...')}</h1>
            </div>
          </div>
        )}

        {viewMode === 'feeds' && feed && selectedFeed && (
          <FeedView
            feed={{ ...feed, items: filteredFeeds || feed.items }}
            onItemSelect={handleItemSelect}
          />
        )}

        {viewMode === 'article' && selectedItem && (
          <ItemView item={selectedItem} onImport={handleImport} />
        )}
      </div>
    </div>
  );
}
