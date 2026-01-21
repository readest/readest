'use client';

import { IoChevronForward } from 'react-icons/io5';
import { useTranslation } from '@/hooks/useTranslation';
import { OPDSNavigationItem, SYMBOL } from '@/types/opds';

interface NavigationCardProps {
  item: OPDSNavigationItem;
  baseURL: string;
  onClick: (href: string) => void;
  resolveURL: (url: string, base: string) => string;
}

export function NavigationCard({ item, baseURL, onClick, resolveURL }: NavigationCardProps) {
  const _ = useTranslation();
  const href = resolveURL(item.href || '', baseURL);
  const summary = item[SYMBOL.SUMMARY];

  return (
    <div
      role='none'
      onClick={() => onClick(href)}
      className='card bg-base-100 border-base-300 hover:bg-base-200/30 cursor-pointer rounded-lg border shadow-sm transition-shadow'
    >
      <div className='card-body flex justify-center p-4'>
        <div className='flex items-start gap-3'>
          <div className='min-w-0 flex-1'>
            <h3 title={item.title || _('Untitled')} className='line-clamp-1 text-sm font-semibold'>
              {item.title || _('Untitled')}
            </h3>
            {item.properties?.numberOfItems && (
              <p className='text-base-content/60 text-xs'>
                {_('{{count}} items', { count: item.properties.numberOfItems })}
              </p>
            )}
            {summary && (
              <p title={summary} className='text-base-content/70 mt-1 line-clamp-1 text-xs'>
                {summary}
              </p>
            )}
          </div>
          <div className='flex h-full items-center justify-center'>
            <IoChevronForward className='text-base-content/40 h-5 w-5 flex-shrink-0' />
          </div>
        </div>
      </div>
    </div>
  );
}
