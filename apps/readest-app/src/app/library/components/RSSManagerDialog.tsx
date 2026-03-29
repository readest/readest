'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { RSSCatalog } from '@/types/rss';
import { RSSManager } from '@/app/rss/components/RSSManager';
import { FeedView } from '@/app/rss/components/FeedView';
import { ItemView } from '@/app/rss/components/ItemView';
import { fetchRSSFeed } from '@/services/rss/rssFetcher';
import { RSSFeed, RSSItem } from '@/types/rss';
import { FiArrowLeft } from 'react-icons/fi';

interface RSSManagerDialogProps {
  onClose: () => void;
}

type ViewMode = 'manager' | 'feed' | 'item' | 'loading';

export function RSSManagerDialog({ onClose }: RSSManagerDialogProps) {
  const _ = useTranslation();
  const { appService } = useEnv();
  const searchParams = useSearchParams();
  const [viewMode, setViewMode] = useState<ViewMode>('manager');
  const [selectedFeed, setSelectedFeed] = useState<RSSCatalog | null>(null);
  const [selectedItem, setSelectedItem] = useState<RSSItem | null>(null);
  const [feed, setFeed] = useState<RSSFeed | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const catalogId = searchParams?.get('rss-id');
    const catalogUrl = searchParams?.get('rss-url');

    if (catalogId || catalogUrl) {
      const catalog: RSSCatalog = {
        id: catalogId || 'custom',
        name: 'Custom Feed',
        url: catalogUrl || '',
      };
      loadFeed(catalog);
    }
  }, [searchParams]);

  const loadFeed = async (catalog: RSSCatalog) => {
    setLoading(true);
    try {
      const fetchedFeed = await fetchRSSFeed(catalog.url, catalog.fileContent);
      setFeed(fetchedFeed);
      setSelectedFeed(catalog);
      setViewMode('feed');
    } catch (e) {
      console.error('Failed to load RSS feed:', e);
      const errorMessage = (e as Error).message;
      
      // Show helpful error for 404s
      if (errorMessage.includes('404')) {
        eventDispatcher.dispatch('toast', {
          message: _('This RSS feed is no longer available (404 Not Found). The feed URL may be outdated.'),
          timeout: 8000,
          type: 'error',
        });
      } else {
        eventDispatcher.dispatch('toast', {
          message: _('Failed to load RSS feed: ') + errorMessage,
          timeout: 8000,
          type: 'error',
        });
      }
      // Go back to manager on error
      handleBackToManager();
    } finally {
      setLoading(false);
    }
  };

  const handleFeedSelect = (catalog: RSSCatalog) => {
    loadFeed(catalog);
  };

  const handleItemSelect = (item: RSSItem) => {
    setSelectedItem(item);
    setViewMode('item');
  };

  const handleBackToManager = () => {
    setSelectedFeed(null);
    setSelectedItem(null);
    setFeed(null);
    setViewMode('manager');
    // Clear URL params
    const newURL = new URL(window.location.href);
    newURL.searchParams.delete('rss-id');
    newURL.searchParams.delete('rss-url');
    window.history.replaceState({}, '', newURL.toString());
  };

  const handleBackToFeed = () => {
    setSelectedItem(null);
    setViewMode('feed');
  };

  const handleImport = async (item: RSSItem) => {
    // TODO: Implement PDF download/import
    if (item.metadata.link) {
      window.open(item.metadata.link, '_blank');
    }
  };

  // Handle drag-drop at the dialog level
  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('[RSS Dialog] File dropped:', e.dataTransfer.files?.[0]?.name);
    // Dispatch custom event for RSS Manager to handle
    const file = e.dataTransfer.files?.[0];
    if (file) {
      window.dispatchEvent(new CustomEvent('rss-file-drop', { detail: { file } }));
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('[RSS Dialog] Drag over');
  };

  return (
    <div 
      className='fixed inset-0 z-50 flex flex-col bg-base-100'
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      {/* Header */}
      <div className='border-base-200 flex items-center justify-between border-b px-6 py-4'>
        <div className='flex items-center gap-4'>
          {viewMode !== 'manager' && (
            <button className='btn btn-ghost btn-sm' onClick={viewMode === 'feed' ? handleBackToManager : handleBackToFeed}>
              <FiArrowLeft size={20} />
            </button>
          )}
          <h2 className='text-xl font-bold'>
            {viewMode === 'manager' && _('RSS Feeds')}
            {viewMode === 'feed' && selectedFeed?.name}
            {viewMode === 'item' && _('Article')}
          </h2>
        </div>
        <button className='btn btn-ghost btn-sm' onClick={onClose}>
          <svg xmlns='http://www.w3.org/2000/svg' className='h-5 w-5' viewBox='0 0 20 20' fill='currentColor'>
            <path fillRule='evenodd' d='M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z' clipRule='evenodd' />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className='flex-1 overflow-auto'>
        {viewMode === 'manager' && (
          <RSSManager onFeedSelect={handleFeedSelect} onClose={onClose} />
        )}

        {viewMode === 'loading' && (
          <div className='flex h-full items-center justify-center'>
            <div className='text-center'>
              <div className='loading loading-spinner loading-lg mb-4'></div>
              <h1 className='text-base font-semibold'>{_('Loading...')}</h1>
            </div>
          </div>
        )}

        {viewMode === 'feed' && feed && selectedFeed && (
          <FeedView
            feed={feed}
            onItemSelect={handleItemSelect}
          />
        )}

        {viewMode === 'item' && selectedItem && (
          <ItemView item={selectedItem} onImport={handleImport} />
        )}
      </div>
    </div>
  );
}
