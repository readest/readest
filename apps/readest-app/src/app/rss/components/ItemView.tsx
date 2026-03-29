'use client';

import { useState } from 'react';
import { RSSItem } from '@/types/rss';
import { useTranslation } from '@/hooks/useTranslation';
import { openUrl } from '@tauri-apps/plugin-opener';
import { isTauriAppPlatform } from '@/services/environment';
import { ArticleReader } from './ArticleReader';
import {
  FiUser,
  FiCalendar,
  FiBook,
  FiHash,
  FiExternalLink,
  FiDownload,
  FiSearch,
  FiCopy,
  FiBookOpen,
  FiBookmark,
  FiTrash2,
  FiSave,
} from 'react-icons/fi';
import { eventDispatcher } from '@/utils/event';
import {
  bookmarkArticle,
  unbookmarkArticle,
  deleteArticle,
  saveArticleToLibrary,
  isBookmarked,
  isSaved,
} from '@/services/rss/articleManager';
import { useSettingsStore } from '@/store/settingsStore';

interface ItemViewProps {
  item: RSSItem;
  onImport: (item: RSSItem) => void;
  feedId?: string;
  onRefresh?: () => void;
}

export function ItemView({ item, onImport, feedId = '', onRefresh }: ItemViewProps) {
  const _ = useTranslation();
  const [fetchingDOI, setFetchingDOI] = useState(false);
  const [showArticleReader, setShowArticleReader] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const settings = useSettingsStore((state) => state.settings);
  
  const bookmarked = isBookmarked(item);
  const saved = isSaved(item);

  // Detect if this is an academic article
  const isAcademicArticle = (item: RSSItem): boolean => {
    const academicDomains = [
      'arxiv.org',
      'biorxiv.org',
      'medrxiv.org',
      'nature.com',
      'science.org',
      'pnas.org',
      'plos.org',
      'cell.com',
      'springer.com',
      'elsevier.com',
      'wiley.com',
      'tandfonline.com',
      'academic.oup.com',
      'ebsco.com',
      'ebscohost.com',
      'psycnet.apa.org',
      'apa.org',
      'sciencedirect.com',
      'jstor.org',
      'cambridge.org',
      'sagepub.com',
      'doi.org',
      'dx.doi.org',
    ];
    
    // Check if link is from academic domain
    if (item.metadata.link) {
      const url = item.metadata.link.toLowerCase();
      if (academicDomains.some((domain) => url.includes(domain))) {
        return true;
      }
    }
    
    // Check if DOI is present (strong indicator of academic paper)
    if (item.metadata.doi) {
      return true;
    }
    
    // Check if journal or publisher is specified
    if (item.metadata.journal || item.metadata.publisher) {
      return true;
    }
    
    // Check for academic-specific metadata
    if (item.metadata.subject && item.metadata.subject.some(s => 
      /journal|academic|research|peer-reviewed/i.test(s)
    )) {
      return true;
    }
    
    return false;
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const handleBookmark = async () => {
    setIsProcessing(true);
    try {
      if (bookmarked) {
        await unbookmarkArticle(item);
      } else {
        await bookmarkArticle(item, feedId);
      }
      onRefresh?.();
    } catch (error) {
      console.error('Failed to toggle bookmark:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDelete = async () => {
    setIsProcessing(true);
    try {
      await deleteArticle(item);
      // Navigate back to feeds after deletion
      onRefresh?.();
    } catch (error) {
      console.error('Failed to delete article:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSaveToLibrary = async () => {
    setIsProcessing(true);
    try {
      const format = settings.articleManagement?.defaultSaveFormat || 'html';
      await saveArticleToLibrary(item, feedId, format);
      eventDispatcher.dispatch('toast', {
        message: _('Article saved to library!'),
        timeout: 3000,
        type: 'success',
      });
      // Reload the library data
      window.dispatchEvent(new CustomEvent('library-data-changed'));
    } catch (error) {
      console.error('Failed to save to library:', error);
      eventDispatcher.dispatch('toast', {
        message: _('Failed to save article: ') + (error as Error).message,
        timeout: 5000,
        type: 'error',
      });
    } finally {
      setIsProcessing(false);
    }
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
            <>
              <button 
                className='btn btn-outline' 
                onClick={() => setShowArticleReader(true)}
              >
                <FiBookOpen size={18} />
                {_('Read Inline')}
              </button>
              <button className='btn btn-ghost' onClick={() => handleOpenLink(item.metadata.link!)}>
                <FiExternalLink size={18} />
                {_('Open in Browser')}
              </button>
            </>
          )}

          {/* Article Management Actions */}
          <div className='divider divider-horizontal mx-2' />
          
          <button
            className={`btn ${bookmarked ? 'btn-warning' : 'btn-ghost'}`}
            onClick={handleBookmark}
            disabled={isProcessing}
            title={bookmarked ? _('Remove Bookmark') : _('Bookmark Article')}
          >
            <FiBookmark size={18} />
          </button>
          
          <button
            className={`btn ${saved ? 'btn-success' : 'btn-ghost'}`}
            onClick={handleSaveToLibrary}
            disabled={isProcessing}
            title={saved ? _('Saved to Library') : _('Save to Library')}
          >
            <FiSave size={18} />
          </button>
          
          <button
            className='btn btn-ghost text-error hover:bg-error hover:text-error-content'
            onClick={handleDelete}
            disabled={isProcessing}
            title={_('Delete Article')}
          >
            <FiTrash2 size={18} />
          </button>

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

        {/* Article State Indicators */}
        {(bookmarked || saved) && (
          <div className='mt-4 flex gap-2'>
            {bookmarked && (
              <span className='badge badge-warning badge-sm'>
                <FiBookmark className='mr-1 h-3 w-3' />
                {_('Bookmarked')}
              </span>
            )}
            {saved && (
              <span className='badge badge-success badge-sm'>
                <FiSave className='mr-1 h-3 w-3' />
                {_('Saved to Library')}
              </span>
            )}
          </div>
        )}

        {/* Article Reader Modal */}
        {showArticleReader && (
          <ArticleReader
            item={item}
            onClose={() => setShowArticleReader(false)}
          />
        )}

        {/* Description/Abstract */}
        {item.metadata.description && (
          <div className='prose mt-6 max-w-none'>
            <h2 className='text-lg font-semibold'>
              {isAcademicArticle(item) ? _('Abstract') : _('Summary')}
            </h2>
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
