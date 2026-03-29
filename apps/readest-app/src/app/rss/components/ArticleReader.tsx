'use client';

import { useState, useEffect, useRef } from 'react';
import { RSSItem } from '@/types/rss';
import { useTranslation } from '@/hooks/useTranslation';
import { fetchArticleContent } from '@/services/rss/articleFetcher';
import { FiLoader, FiX, FiMaximize, FiMinimize } from 'react-icons/fi';

interface ArticleReaderProps {
  item: RSSItem;
  onClose: () => void;
}

export function ArticleReader({ item, onClose }: ArticleReaderProps) {
  const _ = useTranslation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState<{
    title: string;
    content: string;
    author?: string;
    publishedTime?: string;
    siteName?: string;
  } | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Detect if this is an academic article
  const isAcademicArticle = (): boolean => {
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
    ];
    
    if (item.metadata.link) {
      const url = item.metadata.link.toLowerCase();
      if (academicDomains.some((domain) => url.includes(domain))) {
        return true;
      }
    }
    
    if (item.metadata.doi) {
      return true;
    }
    
    if (item.metadata.journal || item.metadata.publisher) {
      return true;
    }
    
    return false;
  };

  useEffect(() => {
    // Add image error handlers when content loads
    if (contentRef.current && content) {
      const images = contentRef.current.querySelectorAll('img');
      images.forEach((img) => {
        let loadAttempted = false;
        
        img.addEventListener('error', () => {
          // Try to reload via proxy if not already using it
          if (!loadAttempted && !img.src.includes('/api/rss/article-proxy')) {
            loadAttempted = true;
            const proxyUrl = `/api/rss/article-proxy?url=${encodeURIComponent(img.src)}`;
            console.log('[ArticleReader] Retrying image via proxy:', img.src);
            img.src = proxyUrl;
            return;
          }
          
          // If proxy also fails, show placeholder (don't log - it's expected for some images)
          img.style.backgroundColor = 'rgba(128,128,128,0.1)';
          img.style.minHeight = '100px';
          img.alt = 'Image unavailable';
        });
      });
    }
  }, [content]);

  useEffect(() => {
    const loadArticle = async () => {
      if (!item.metadata.link) {
        setError(_('No article link available'));
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        const article = await fetchArticleContent(item.metadata.link, {
          sanitize: true,
          keepImages: true,
        });

        setContent({
          title: article.title,
          content: article.content,
          author: article.author,
          publishedTime: article.publishedTime,
          siteName: article.siteName,
        });
      } catch (err) {
        console.error('Failed to load article:', err);
        setError(err instanceof Error ? err.message : _('Failed to load article'));
      } finally {
        setLoading(false);
      }
    };

    loadArticle();
  }, [item.metadata.link, _]);

  const formatDate = (dateString?: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  return (
    <div className={`fixed inset-0 z-50 flex ${isExpanded ? '' : 'items-end'}`}>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Reader Panel */}
      <div
        className={`relative z-10 flex w-full flex-col bg-base-100 shadow-2xl transition-all duration-300 ${
          isExpanded ? 'h-full' : 'h-[80vh] max-h-[600px]'
        }`}
      >
        {/* Header */}
        <div className="border-base-300 flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              className="btn btn-ghost btn-sm"
              onClick={onClose}
              aria-label={_('Close')}
            >
              <FiX size={20} />
            </button>
            <div className="flex flex-col">
              <h2 className="text-base font-semibold">
                {loading ? _('Loading...') : content?.title || item.metadata.title}
              </h2>
              {content?.siteName && (
                <span className="text-xs text-base-content/60">{content.siteName}</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setIsExpanded(!isExpanded)}
              aria-label={isExpanded ? _('Collapse') : _('Expand')}
            >
              {isExpanded ? <FiMinimize size={18} /> : <FiMaximize size={18} />}
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex h-full flex-col items-center justify-center gap-4">
              <FiLoader className="animate-spin" size={48} />
              <p className="text-base-content/70">{_('Fetching article content...')}</p>
              <p className="text-xs text-base-content/50">{_('This may take a moment')}</p>
            </div>
          )}

          {error && (
            <div className="p-6">
              <div className="alert alert-error">
                <span>{error}</span>
                {item.metadata.link && (
                  <a
                    href={item.metadata.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-ghost btn-sm"
                  >
                    {_('Open in Browser')}
                  </a>
                )}
              </div>
            </div>
          )}

          {content && (
            <article className="prose mx-auto max-w-3xl p-6 dark:prose-invert">
              {/* Article Metadata */}
              <header className="mb-6">
                <h1 className="text-2xl font-bold">{content.title}</h1>

                {(content.author || content.publishedTime) && (
                  <div className="text-base-content/70 mt-3 flex flex-wrap items-center gap-3 text-sm">
                    {content.author && (
                      <span className="font-medium">{content.author}</span>
                    )}
                    {content.publishedTime && (
                      <time className="text-base-content/60">
                        {formatDate(content.publishedTime)}
                      </time>
                    )}
                  </div>
                )}
              </header>

              {/* Article Body */}
              <div
                ref={contentRef}
                className="text-base-content/90 leading-relaxed"
                dangerouslySetInnerHTML={{ __html: content.content }}
              />

              {/* Styles for article content */}
              <style>{`
                .prose img {
                  max-width: 100%;
                  height: auto;
                  margin: 1.5rem auto;
                  display: block;
                  border-radius: 0.375rem;
                }
                .prose figure {
                  margin: 2rem 0;
                }
                .prose figcaption {
                  text-align: center;
                  font-size: 0.875rem;
                  color: rgb(107 114 128);
                  margin-top: 0.5rem;
                }
                .prose .wp-block-image {
                  margin: 1.5rem auto;
                }
                .prose .aligncenter {
                  text-align: center;
                }
                .prose .alignleft {
                  float: left;
                  margin-right: 1.5rem;
                }
                .prose .alignright {
                  float: right;
                  margin-left: 1.5rem;
                }
                .prose .featured-image {
                  margin: 0 0 2rem 0;
                }
                .prose .featured-image img {
                  width: 100%;
                  height: auto;
                  object-fit: cover;
                }
              `}</style>

              {/* Footer Note */}
              <footer className="border-base-300 mt-8 pt-6 text-center text-sm text-base-content/50">
                <p>
                  {_('Source:')}{' '}
                  {item.metadata.link && (
                    <a
                      href={item.metadata.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="link link-primary"
                    >
                      {new URL(item.metadata.link).hostname}
                    </a>
                  )}
                </p>
              </footer>
            </article>
          )}
        </div>
      </div>
    </div>
  );
}
