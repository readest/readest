'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { useEnv } from '@/context/EnvContext';
import { Toast } from '@/components/Toast';
import { useThemeStore } from '@/store/themeStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { RSSCatalog, RSSFeed, RSSItem } from '@/types/rss';
import { fetchRSSFeed } from '@/services/rss/rssFetcher';
import { FeedView } from './components/FeedView';
import { ItemView } from './components/ItemView';
import { RSSManager } from './components/RSSManager';
import {
  FiArrowLeft,
  FiRefreshCw,
} from 'react-icons/fi';

type ViewMode = 'manager' | 'feed' | 'item' | 'loading' | 'error';

interface RSSState {
  feed?: RSSFeed;
  item?: RSSItem;
  catalog?: RSSCatalog;
}

export default function RSSPage() {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { safeAreaInsets } = useThemeStore();
  const { settings } = useSettingsStore();
  const searchParams = useSearchParams();
  const [viewMode, setViewMode] = useState<ViewMode>('manager');
  const [state, setState] = useState<RSSState>({});
  const [error, setError] = useState<Error | null>(null);

  const catalogId = searchParams?.get('id') || '';
  const catalogUrl = searchParams?.get('url') || '';

  const loadRSSFeed = useCallback(
    async (catalog: RSSCatalog) => {
      setViewMode('loading');
      setError(null);

      try {
        const feed = await fetchRSSFeed(catalog.url, catalog.fileContent);
        setState({
          catalog,
          feed,
        });
        setViewMode('feed');
      } catch (e) {
        console.error('Failed to load RSS feed:', e);
        setError(e as Error);
        setViewMode('error');
        eventDispatcher.dispatch('toast', {
          message: _('Failed to load RSS feed: {{message}}', {
            message: (e as Error).message,
          }),
          timeout: 5000,
          type: 'error',
        });
      }
    },
    [_],
  );

  useEffect(() => {
    if (catalogId || catalogUrl) {
      // Look up the full catalog from settings if we have an ID
      const catalog = catalogId 
        ? settings.rssFeeds?.find((f) => f.id === catalogId) || {
            id: catalogId,
            name: _('Custom Feed'),
            url: catalogUrl,
          }
        : {
            id: 'custom',
            name: _('Custom Feed'),
            url: catalogUrl,
          };
      loadRSSFeed(catalog);
    }
  }, [catalogId, catalogUrl, settings.rssFeeds, loadRSSFeed, _]);

  const handleFeedSelect = (catalog: RSSCatalog) => {
    const newURL = new URL(window.location.href);
    newURL.searchParams.set('id', catalog.id);
    newURL.searchParams.set('url', catalog.url || '');
    window.history.pushState({}, '', newURL.toString());
    // Pass the full catalog including fileContent for local feeds
    loadRSSFeed(catalog);
  };

  const handleItemSelect = (item: RSSItem) => {
    setState((prev) => ({ ...prev, item }));
    setViewMode('item');
  };

  const handleBackToFeed = () => {
    setState((prev) => ({ ...prev, item: undefined }));
    setViewMode('feed');
  };

  const handleBackToManager = () => {
    const newURL = new URL(window.location.href);
    newURL.searchParams.delete('id');
    newURL.searchParams.delete('url');
    window.history.pushState({}, '', newURL.toString());
    setState({});
    setViewMode('manager');
  };

  const handleImport = async (item: RSSItem) => {
    if (!appService) return;

    try {
      // Check if item has direct PDF link
      const pdfUrl =
        item.enclosures?.find((e) => e.type?.includes('pdf'))?.url ||
        item.links?.find((l) => l.type?.includes('pdf'))?.href;

      if (pdfUrl) {
        // Download PDF directly
        eventDispatcher.dispatch('toast', {
          message: _('Downloading PDF...'),
          timeout: 3000,
          type: 'info',
        });

        // TODO: Implement PDF download and import
        // For now, open the link
        window.open(pdfUrl, '_blank');
      } else if (item.metadata.doi) {
        // Resolve DOI to find PDF
        eventDispatcher.dispatch('toast', {
          message: _('Opening DOI resolver...'),
          timeout: 3000,
          type: 'info',
        });

        window.open(`https://doi.org/${item.metadata.doi}`, '_blank');
      } else if (item.metadata.link) {
        // Open article page
        window.open(item.metadata.link, '_blank');
      }
    } catch (e) {
      console.error('Import failed:', e);
      eventDispatcher.dispatch('toast', {
        message: _('Failed to import article'),
        timeout: 5000,
        type: 'error',
      });
    }
  };

  return (
    <div className='bg-base-100 flex h-screen flex-col'>
      {/* Header */}
      <div
        className='border-base-200 relative top-0 z-40 flex items-center justify-between border-b px-4 py-2'
        style={{
          paddingTop: `${safeAreaInsets?.top || 0}px`,
        }}
      >
        <div className='flex items-center gap-2'>
          {viewMode !== 'manager' && (
            <button className='btn btn-ghost btn-sm' onClick={handleBackToManager}>
              <FiArrowLeft size={20} />
            </button>
          )}
          {viewMode === 'feed' && (
            <button className='btn btn-ghost btn-sm' onClick={handleBackToFeed}>
              <FiArrowLeft size={20} />
            </button>
          )}
          <h1 className='text-lg font-semibold'>
            {viewMode === 'manager' && _('RSS Feeds')}
            {viewMode === 'feed' && state.catalog?.name}
            {viewMode === 'item' && _('Article')}
          </h1>
        </div>
        <div className='flex items-center gap-2'>
          {viewMode === 'feed' && (
            <button
              className='btn btn-ghost btn-sm'
              onClick={() => loadRSSFeed(state.catalog!)}
              title={_('Refresh')}
            >
              <FiRefreshCw size={18} />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <main className='flex-1 overflow-auto'>
        {viewMode === 'manager' && <RSSManager onFeedSelect={handleFeedSelect} onClose={() => {}} />}

        {viewMode === 'loading' && (
          <div className='flex h-full items-center justify-center'>
            <div className='text-center'>
              <div className='loading loading-spinner loading-lg mb-4'></div>
              <h1 className='text-base font-semibold'>{_('Loading...')}</h1>
            </div>
          </div>
        )}

        {viewMode === 'error' && (
          <div className='flex h-full items-center justify-center'>
            <div className='max-w-md text-center'>
              <h1 className='text-error mb-4 text-xl font-bold'>{_('Failed to Load Feed')}</h1>
              <p className='text-base-content/70 mb-4'>{error?.message || _('An error occurred')}</p>
              <button className='btn btn-primary' onClick={() => handleBackToManager()}>
                {_('Back to Feeds')}
              </button>
            </div>
          </div>
        )}

        {viewMode === 'feed' && state.feed && (
          <FeedView
            feed={state.feed}
            onItemSelect={handleItemSelect}
          />
        )}

        {viewMode === 'item' && state.item && (
          <ItemView item={state.item} onImport={handleImport} />
        )}
      </main>

      <Toast />
    </div>
  );
}
