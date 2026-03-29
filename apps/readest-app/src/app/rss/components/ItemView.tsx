'use client';

import { useState } from 'react';
import { RSSItem } from '@/types/rss';
import { useTranslation } from '@/hooks/useTranslation';
import { openUrl } from '@tauri-apps/plugin-opener';
import { isTauriAppPlatform } from '@/services/environment';
import {
  FiUser,
  FiCalendar,
  FiBook,
  FiHash,
  FiExternalLink,
  FiDownload,
  FiSearch,
  FiCopy,
} from 'react-icons/fi';

interface ItemViewProps {
  item: RSSItem;
  onImport: (item: RSSItem) => void;
  baseURL?: string;
}

export function ItemView({ item, onImport, baseURL }: ItemViewProps) {
  const _ = useTranslation();
  const [fetchingDOI, setFetchingDOI] = useState(false);

  const formatDate = (dateString?: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const handleOpenLink = async (url: string) => {
    try {
      if (isTauriAppPlatform()) {
        await openUrl(url);
      } else {
        window.open(url, '_blank');
      }
    } catch (e) {
      console.error('Failed to open link:', e);
    }
  };

  const handleResolveDOI = async () => {
    if (!item.metadata.doi) return;

    setFetchingDOI(true);
    try {
      // Open DOI resolver
      const doiUrl = `https://doi.org/${item.metadata.doi}`;
      await handleOpenLink(doiUrl);
    } finally {
      setFetchingDOI(false);
    }
  };

  const hasPDF =
    item.enclosures?.some((e) => e.type?.includes('pdf')) ||
    item.links?.some((l) => l.type?.includes('pdf'));

  return (
    <div className='p-6'>
      <div className='mx-auto max-w-3xl'>
        {/* Title */}
        <h1 className='text-2xl font-bold'>{item.metadata.title}</h1>

        {/* Metadata */}
        <div className='text-base-content/70 mt-4 flex flex-wrap items-center gap-3 text-sm'>
          {item.metadata.author && (
            <div className='flex items-center gap-1'>
              <FiUser size={16} />
              <span>{item.metadata.author}</span>
            </div>
          )}

          {item.metadata.pubDate && (
            <div className='flex items-center gap-1'>
              <FiCalendar size={16} />
              <time>{formatDate(item.metadata.pubDate)}</time>
            </div>
          )}

          {item.metadata.journal && (
            <div className='flex items-center gap-1'>
              <FiBook size={16} />
              <span>{item.metadata.journal}</span>
            </div>
          )}
        </div>

        {/* DOI Badge */}
        {item.metadata.doi && (
          <div className='bg-primary/10 mt-4 flex items-center justify-between rounded-lg p-3'>
            <div className='flex items-center gap-2'>
              <FiHash size={18} />
              <span className='font-mono text-sm'>{item.metadata.doi}</span>
            </div>
            <div className='flex gap-2'>
              <button
                className='btn btn-primary btn-sm'
                onClick={handleResolveDOI}
                disabled={fetchingDOI}
              >
                {fetchingDOI ? _('Resolving...') : _('Resolve DOI')}
              </button>
              <button
                className='btn btn-ghost btn-sm'
                onClick={() =>
                  navigator.clipboard.writeText(`https://doi.org/${item.metadata.doi}`)
                }
              >
                <FiCopy size={16} />
              </button>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className='mt-6 flex flex-wrap gap-3'>
          {item.metadata.link && (
            <button className='btn btn-outline' onClick={() => handleOpenLink(item.metadata.link!)}>
              <FiExternalLink size={18} />
              {_('Open Article')}
            </button>
          )}

          {hasPDF && (
            <button
              className='btn btn-primary'
              onClick={() => onImport(item)}
            >
              <FiDownload size={18} />
              {_('Download PDF')}
            </button>
          )}

          {!hasPDF && item.metadata.doi && (
            <button
              className='btn btn-secondary'
              onClick={() => onImport(item)}
            >
              <FiSearch size={18} />
              {_('Find PDF via DOI')}
            </button>
          )}
        </div>

        {/* Description/Abstract */}
        {item.metadata.description && (
          <div className='prose mt-6 max-w-none'>
            <h2 className='text-lg font-semibold'>{_('Abstract')}</h2>
            <div
              className='text-base-content/80 mt-2'
              dangerouslySetInnerHTML={{ __html: item.metadata.description }}
            />
          </div>
        )}

        {/* Content (if available) */}
        {item.metadata.content && item.metadata.content !== item.metadata.description && (
          <div className='prose mt-6 max-w-none'>
            <h2 className='text-lg font-semibold'>{_('Full Content')}</h2>
            <div
              className='text-base-content/80 mt-2'
              dangerouslySetInnerHTML={{ __html: item.metadata.content }}
            />
          </div>
        )}

        {/* Subjects/Tags */}
        {item.metadata.subject && item.metadata.subject.length > 0 && (
          <div className='mt-6'>
            <h2 className='text-lg font-semibold'>{_('Subjects')}</h2>
            <div className='mt-2 flex flex-wrap gap-2'>
              {item.metadata.subject.map((subject, idx) => (
                <span key={idx} className='badge badge-outline'>
                  {subject}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Links */}
        {item.links.length > 0 && (
          <div className='mt-6'>
            <h2 className='text-lg font-semibold'>{_('Links')}</h2>
            <ul className='mt-2 space-y-1'>
              {item.links.map((link, idx) => (
                <li key={idx}>
                  <button
                    className='link link-primary'
                    onClick={() => handleOpenLink(link.href)}
                  >
                    {link.title || link.href}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
