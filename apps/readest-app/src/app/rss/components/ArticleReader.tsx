'use client';

import { useState, useEffect, useRef } from 'react';
import { RSSItem } from '@/types/rss';
import { fetchArticleContent } from '@/services/rss/articleFetcher';
import { FiLoader, FiX } from 'react-icons/fi';

interface ArticleReaderProps {
  item: RSSItem;
  onClose: () => void;
}

export function ArticleReader({ item, onClose }: ArticleReaderProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState<{
    title: string;
    content: string;
    author?: string;
    publishedTime?: string;
    siteName?: string;
  } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

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
            img.src = proxyUrl;
          }
        });
      });
    }
  }, [content]);

  useEffect(() => {
    const fetchContent = async () => {
      try {
        setLoading(true);
        // Check if we already have fetched content
        if (item.metadata.fetchedContent) {
          setContent({
            title: item.metadata.fetchedContent.title,
            content: item.metadata.fetchedContent.content,
            author: item.metadata.fetchedContent.author,
            publishedTime: item.metadata.fetchedContent.publishedTime,
            siteName: item.metadata.fetchedContent.siteName,
          });
          setLoading(false);
          return;
        }

        if (!item.metadata.link) {
          throw new Error('No link available for this article');
        }

        const result = await fetchArticleContent(item.metadata.link);
        setContent(result);
      } catch (err) {
        console.error('Failed to fetch article:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch article');
      } finally {
        setLoading(false);
      }
    };

    fetchContent();
  }, [item]);

  const handleOpenInBrowser = () => {
    if (item.metadata.link) {
      window.open(item.metadata.link, '_blank');
    }
  };

  return (
    <div className="bg-base-100 fixed inset-0 z-[100] flex flex-col">
      {/* Header */}
      <div className="bg-base-100/95 backdrop-blur border-base-300 flex flex-shrink-0 items-center justify-between border-b px-6 py-3">
        <div className="flex flex-1 items-center justify-center gap-4">
          <h2 className="text-lg font-bold line-clamp-1 text-center">
            {content?.title || item.metadata.title}
          </h2>
          {content?.siteName && (
            <span className="badge badge-ghost badge-sm">{content.siteName}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {error && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={handleOpenInBrowser}
              title="Open in browser"
            >
              Open in Browser
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            <FiX size={20} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto" ref={contentRef}>
        {loading && (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <FiLoader className="loading loading-spinner loading-lg mb-4" />
              <p className="text-base-content/70">Loading article...</p>
            </div>
          </div>
        )}

        {error && (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <p className="text-error mb-4">{error}</p>
              <button className="btn btn-primary" onClick={handleOpenInBrowser}>
                Open in Browser
              </button>
            </div>
          </div>
        )}

        {content && (
          <div className="mx-auto max-w-3xl p-6">
            <article
              className="prose prose-base dark:prose-invert"
              dangerouslySetInnerHTML={{ __html: content.content }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
