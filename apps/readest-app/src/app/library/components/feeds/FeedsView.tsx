'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MdAdd, MdDelete, MdRefresh, MdArrowBack } from 'react-icons/md';
import Dialog from '@/components/Dialog';
import { useTranslation } from '@/hooks/useTranslation';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useFeedStore } from '@/store/feedStore';
import { openFeedArticle, handleOpenArticle } from '@/services/rss/articleIngest';
import { navigateToReader } from '@/utils/nav';
import { eventDispatcher } from '@/utils/event';
import { formatDate } from '@/utils/book';
import type { RssFeed, RssFeedItem } from '@/types/rss';
import AddFeedModal from './AddFeedModal';

interface FeedsViewProps {
  onClose: () => void;
}

export function FeedsView({ onClose }: FeedsViewProps) {
  const _ = useTranslation();
  const router = useRouter();
  const { envConfig, appService } = useEnv();
  const { user } = useAuth();
  const { settings } = useSettingsStore();
  const feeds = useFeedStore((s) => s.feeds);
  const [selectedFeed, setSelectedFeed] = useState<RssFeed | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [refreshing, setRefreshing] = useState<string | null>(null);

  const hydratedRef = useRef(false);

  useEffect(() => {
    if (!appService) return;
    appService
      .loadFeeds()
      .then((loaded) => {
        useFeedStore.getState().hydrate(loaded);
        hydratedRef.current = true;
      })
      .catch(() => {
        hydratedRef.current = true;
      });
  }, [appService]);

  useEffect(() => {
    if (!appService || !hydratedRef.current) return;
    appService.saveFeeds(feeds).catch(() => {});
  }, [appService, feeds]);

  const handleRefresh = async (feed: RssFeed) => {
    setRefreshing(feed.id);
    try {
      await useFeedStore.getState().refreshFeed(feed.id);
    } finally {
      setRefreshing(null);
    }
  };

  const handleRemove = (id: string) => {
    useFeedStore.getState().removeFeed(id);
    if (selectedFeed?.id === id) setSelectedFeed(null);
  };

  const handleOpenItem = async (item: RssFeedItem, feed: RssFeed) => {
    if (!appService) return;
    eventDispatcher.dispatch('toast', {
      type: 'info',
      message: _('Opening article…'),
      timeout: 2500,
    });
    await handleOpenArticle(
      {
        item,
        feed,
        books: useLibraryStore.getState().library,
        appService,
        settings,
        isLoggedIn: !!user,
        translate: _,
      },
      {
        openArticle: openFeedArticle,
        updateBooks: (books) => useLibraryStore.getState().updateBooks(envConfig, books),
        markRead: () => useFeedStore.getState().markItemRead(feed.id, item.id),
        navigate: (hash) => navigateToReader(router, [hash]),
        onError: (message) =>
          eventDispatcher.dispatch('toast', { type: 'error', message, timeout: 3500 }),
      },
    );
  };

  // Keep selectedFeed in sync when the store updates (refresh may add items).
  const liveFeed = selectedFeed ? (feeds.find((f) => f.id === selectedFeed.id) ?? null) : null;

  const sortedItems = liveFeed
    ? [...liveFeed.items].sort((a, b) => {
        if (a.read !== b.read) return a.read ? 1 : -1;
        const da = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
        const db = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
        return db - da;
      })
    : [];

  return (
    <>
      <Dialog
        isOpen={true}
        title={liveFeed ? liveFeed.title : _('Feeds')}
        onClose={onClose}
        bgClassName='sm:!bg-black/75'
        boxClassName='sm:min-w-[520px] sm:w-3/4 sm:h-[85%] sm:!max-w-screen-sm'
      >
        <div className='bg-base-100 relative flex flex-col overflow-y-auto pb-4'>
          {liveFeed ? (
            /* Article list */
            <div className='flex flex-col'>
              <button
                type='button'
                className='btn btn-ghost btn-sm mb-2 flex items-center gap-1 self-start'
                onClick={() => setSelectedFeed(null)}
                aria-label={_('Back to feed list')}
              >
                <MdArrowBack className='h-4 w-4' />
                {_('Feeds')}
              </button>
              {sortedItems.length === 0 ? (
                <p className='text-base-content/50 px-4 py-8 text-center text-sm'>
                  {_('No articles in this feed.')}
                </p>
              ) : (
                <ul className='divide-base-200 divide-y'>
                  {sortedItems.map((item) => (
                    <li key={item.id}>
                      <button
                        type='button'
                        className={`hover:bg-base-200 w-full cursor-pointer px-4 py-3 text-start transition-colors ${item.read ? 'text-base-content/50' : ''}`}
                        onClick={() => void handleOpenItem(item, liveFeed)}
                      >
                        <div className='flex flex-col gap-1'>
                          <span
                            className={`text-sm leading-snug ${item.read ? 'font-normal' : 'font-medium'}`}
                          >
                            {item.title}
                          </span>
                          {item.publishedAt && (
                            <span className='text-base-content/40 text-xs'>
                              {formatDate(item.publishedAt)}
                            </span>
                          )}
                          {item.summary && (
                            <span className='text-base-content/60 line-clamp-2 text-xs leading-relaxed'>
                              {item.summary}
                            </span>
                          )}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            /* Feed list */
            <div className='flex flex-col'>
              <div className='flex items-center justify-between px-4 py-2'>
                <span className='text-base-content/60 text-sm'>
                  {feeds.length === 0 ? _('No feeds yet.') : ''}
                </span>
                <button
                  type='button'
                  className='btn btn-ghost btn-sm flex items-center gap-1'
                  onClick={() => setShowAddModal(true)}
                  aria-label={_('Add feed')}
                >
                  <MdAdd className='h-4 w-4' />
                  {_('Add feed')}
                </button>
              </div>
              {feeds.length === 0 ? (
                <p className='text-base-content/40 px-4 py-8 text-center text-sm'>
                  {_('Subscribe to a feed to see articles here.')}
                </p>
              ) : (
                <ul className='divide-base-200 divide-y'>
                  {feeds.map((feed) => {
                    const unread = useFeedStore.getState().unreadCount(feed.id);
                    return (
                      <li key={feed.id} className='flex flex-col'>
                        <div className='flex items-center gap-2 px-4 py-3'>
                          <button
                            type='button'
                            className='hover:bg-base-200 flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 rounded text-start transition-colors'
                            onClick={() => setSelectedFeed(feed)}
                          >
                            <div className='flex items-center gap-2'>
                              <span className='text-sm font-medium leading-snug'>{feed.title}</span>
                              {unread > 0 && (
                                <span className='badge badge-primary badge-sm shrink-0 text-xs'>
                                  {unread}
                                </span>
                              )}
                            </div>
                            {feed.description && (
                              <span className='text-base-content/50 truncate text-xs'>
                                {feed.description}
                              </span>
                            )}
                          </button>
                          <div className='flex shrink-0 items-center gap-1'>
                            <button
                              type='button'
                              className='btn btn-ghost btn-xs'
                              aria-label={_('Refresh feed')}
                              title={_('Refresh')}
                              disabled={refreshing === feed.id}
                              onClick={() => void handleRefresh(feed)}
                            >
                              {refreshing === feed.id ? (
                                <span className='loading loading-spinner loading-xs' />
                              ) : (
                                <MdRefresh className='h-4 w-4' />
                              )}
                            </button>
                            <button
                              type='button'
                              className='btn btn-ghost btn-xs text-error'
                              aria-label={_('Remove feed')}
                              title={_('Remove')}
                              onClick={() => handleRemove(feed.id)}
                            >
                              <MdDelete className='h-4 w-4' />
                            </button>
                          </div>
                        </div>
                        {feed.errorMessage && (
                          <p className='text-error px-4 pb-2 text-xs'>{feed.errorMessage}</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      </Dialog>
      <AddFeedModal isOpen={showAddModal} onClose={() => setShowAddModal(false)} />
    </>
  );
}
