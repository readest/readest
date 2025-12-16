'use client';

import { useMemo, useCallback } from 'react';
import { VirtuosoGrid } from 'react-virtuoso';
import { IoChevronBack, IoChevronForward, IoFilter } from 'react-icons/io5';
import { useTranslation } from '@/hooks/useTranslation';
import { OPDSFeed, OPDSLink } from '@/types/opds';
import { PublicationCard } from './PublicationCard';
import { NavigationCard } from './NavigationCard';
import { groupByArray } from '../utils/opdsUtils';

interface FeedViewProps {
  feed: OPDSFeed;
  baseURL: string;
  resolveURL: (url: string, base: string) => string;
  onNavigate: (url: string) => void;
  onPublicationSelect: (groupIndex: number, itemIndex: number) => void;
  onGenerateCachedImageUrl: (url: string) => Promise<string>;
  isOPDSCatalog: (type?: string) => boolean;
}

const gridClassName = 'grid grid-cols-3 gap-4 px-4 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6';
const navigationClassName =
  'grid grid-cols-2 gap-4 px-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 max-[450px]:grid-cols-1';

export function FeedView({
  feed,
  baseURL,
  resolveURL,
  onNavigate,
  onPublicationSelect,
  onGenerateCachedImageUrl,
}: FeedViewProps) {
  const _ = useTranslation();
  const linksByRel = useMemo(() => groupByArray(feed.links, (link) => link.rel), [feed.links]);

  const pagination = useMemo(() => {
    return ['first', 'previous', 'next', 'last'].map((rel) => linksByRel.get(rel));
  }, [linksByRel]);

  const hasFacets = feed.facets && feed.facets.length > 0;

  const handlePaginationClick = (links?: OPDSLink[]) => {
    if (links && links.length > 0) {
      const url = resolveURL(links[0]?.href || '', baseURL);
      onNavigate(url);
    }
  };

  const handleNavigationClick = (href: string) => {
    const url = resolveURL(href, baseURL);
    onNavigate(url);
  };

  const itemContent = useCallback(
    (index: number) => (
      <PublicationCard
        publication={feed.publications![index]!}
        baseURL={baseURL}
        onClick={() => onPublicationSelect(-1, index)}
        resolveURL={resolveURL}
        onGenerateCachedImageUrl={onGenerateCachedImageUrl}
      />
    ),
    [feed.publications, baseURL, onPublicationSelect, resolveURL, onGenerateCachedImageUrl],
  );

  return (
    <div className='flex h-full flex-col'>
      {/* Header */}
      <div className='opds-header flex-shrink-0 px-4 py-6'>
        {feed.metadata?.title && <h1 className='mb-2 text-xl font-bold'>{feed.metadata.title}</h1>}
        {feed.metadata?.subtitle && (
          <p className='text-base-content/70 text-sm'>{feed.metadata.subtitle}</p>
        )}
      </div>

      <div className='flex min-h-0 flex-1 gap-6'>
        {/* Facets Sidebar */}
        {hasFacets && (
          <aside className='hidden w-64 flex-shrink-0 overflow-y-auto lg:block'>
            <div className='px-4'>
              <div className='mb-4 flex items-center gap-2'>
                <IoFilter className='h-5 w-5' />
                <h2 className='text-lg font-semibold'>Filters</h2>
              </div>
              <div className='space-y-6'>
                {feed.facets?.map((facet, index: number) => (
                  <section key={index}>
                    {facet.metadata?.title && (
                      <h3 className='text-base-content/70 mb-2 text-sm font-medium'>
                        {facet.metadata.title}
                      </h3>
                    )}
                    <ul className='space-y-1'>
                      {facet.links.map((link, linkIndex: number) => {
                        const isActive = link.rel === 'self' || link.rel?.includes('self');
                        const href = resolveURL(link.href, baseURL);
                        return (
                          <li key={linkIndex}>
                            <button
                              onClick={() => handleNavigationClick(href)}
                              className={`w-full rounded px-3 py-1.5 text-left text-sm transition-colors ${
                                isActive
                                  ? 'bg-primary text-primary-content font-medium'
                                  : 'hover:bg-base-200'
                              }`}
                            >
                              <div className='flex items-center justify-between'>
                                <span className='truncate'>{link.title || 'Untitled'}</span>
                                {link.properties?.numberOfItems && (
                                  <span className='ml-2 text-xs opacity-70'>
                                    {link.properties.numberOfItems}
                                  </span>
                                )}
                              </div>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))}
              </div>
            </div>
          </aside>
        )}

        {/* Main Content */}
        <div className='flex min-w-0 flex-1 flex-col'>
          {/* Navigation Items */}
          {feed.navigation && feed.navigation.length > 0 && (
            <section className='opds-navigation flex-shrink-0 pb-6'>
              <div className={navigationClassName}>
                {feed.navigation.map((item, index: number) => (
                  <NavigationCard
                    key={index}
                    item={item}
                    baseURL={baseURL}
                    onClick={handleNavigationClick}
                    resolveURL={resolveURL}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Publications Grid - Takes remaining space */}
          {feed.publications && feed.publications.length > 0 && (
            <section className='opds-publications min-h-0 flex-1'>
              <VirtuosoGrid
                style={{ height: '100%' }}
                totalCount={feed.publications.length}
                listClassName={gridClassName}
                itemContent={itemContent}
              />
            </section>
          )}

          {/* Groups */}
          {feed.groups?.map((group, groupIndex: number) => (
            <section key={groupIndex} className='mb-12 flex-shrink-0'>
              {group.metadata && (
                <div className='mb-4 flex items-center justify-between px-4'>
                  <h2 className='text-2xl font-bold'>{group.metadata.title}</h2>
                  {group.links && group.links.length > 0 && (
                    <button
                      onClick={() => {
                        const link = group.links[0];
                        const url = resolveURL(link?.href || '', baseURL);
                        handleNavigationClick(url);
                      }}
                      className='btn btn-sm btn-ghost'
                    >
                      {_('View All')}
                    </button>
                  )}
                </div>
              )}

              {group.navigation && (
                <div className={`opds-navigation ${gridClassName}`}>
                  {group.navigation.map((item, itemIndex: number) => (
                    <NavigationCard
                      key={itemIndex}
                      item={item}
                      baseURL={baseURL}
                      onClick={handleNavigationClick}
                      resolveURL={resolveURL}
                    />
                  ))}
                </div>
              )}

              {group.publications && (
                <div className={`opds-publications ${gridClassName}`}>
                  {group.publications.map((pub, itemIndex: number) => (
                    <PublicationCard
                      key={itemIndex}
                      publication={pub}
                      baseURL={baseURL}
                      onClick={() => onPublicationSelect(groupIndex, itemIndex)}
                      resolveURL={resolveURL}
                      onGenerateCachedImageUrl={onGenerateCachedImageUrl}
                    />
                  ))}
                </div>
              )}
            </section>
          ))}

          {/* Pagination */}
          {pagination.some((links) => links && links.length > 0) && (
            <nav className='flex flex-shrink-0 justify-center gap-2 py-4'>
              <button
                onClick={() => handlePaginationClick(pagination[0])}
                disabled={!pagination[0]}
                className='btn btn-sm'
                title={_('First')}
              >
                <IoChevronBack className='h-4 w-4' />
                <IoChevronBack className='-ml-3 h-4 w-4' />
              </button>
              <button
                onClick={() => handlePaginationClick(pagination[1])}
                disabled={!pagination[1]}
                className='btn btn-sm'
                title={_('Previous')}
              >
                <IoChevronBack className='h-4 w-4' />
                {_('Previous')}
              </button>
              <button
                onClick={() => handlePaginationClick(pagination[2])}
                disabled={!pagination[2]}
                className='btn btn-sm'
                title={_('Next')}
              >
                {_('Next')}
                <IoChevronForward className='h-4 w-4' />
              </button>
              <button
                onClick={() => handlePaginationClick(pagination[3])}
                disabled={!pagination[3]}
                className='btn btn-sm'
                title={_('Last')}
              >
                <IoChevronForward className='h-4 w-4' />
                <IoChevronForward className='-ml-3 h-4 w-4' />
              </button>
            </nav>
          )}
        </div>
      </div>
    </div>
  );
}
