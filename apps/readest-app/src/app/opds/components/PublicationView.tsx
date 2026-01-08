'use client';

import clsx from 'clsx';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IoPricetag } from 'react-icons/io5';
import { Book } from '@/types/book';
import { OPDSLink, OPDSPublication, REL, SYMBOL } from '@/types/opds';
import { useTranslation } from '@/hooks/useTranslation';
import { getFileExtFromMimeType } from '@/libs/document';
import { formatDate, formatLanguage } from '@/utils/book';
import { eventDispatcher } from '@/utils/event';
import { navigateToReader } from '@/utils/nav';
import { CachedImage } from '@/components/CachedImage';
import { groupByArray } from '../utils/opdsUtils';
import Dropdown from '@/components/Dropdown';
import MenuItem from '@/components/MenuItem';

interface PublicationViewProps {
  publication: OPDSPublication;
  baseURL: string;
  resolveURL: (url: string, base: string) => string;
  onDownload: (
    href: string,
    type?: string,
    onProgress?: (progress: { progress: number; total: number }) => void,
  ) => Promise<Book | null | undefined>;
  onGenerateCachedImageUrl: (url: string) => Promise<string>;
}

export function PublicationView({
  publication,
  baseURL,
  resolveURL,
  onDownload,
  onGenerateCachedImageUrl,
}: PublicationViewProps) {
  const _ = useTranslation();
  const router = useRouter();
  const [downloading, setDownloading] = useState(false);
  const [downloadedBook, setDownloadedBook] = useState<Book | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  const linksByRel = useMemo(
    () => groupByArray(publication.links, (link) => link.rel),
    [publication.links],
  );

  const coverImage = useMemo(() => {
    const covers = publication.images?.filter((img) =>
      REL.COVER.some((rel: string) => img.rel?.includes(rel)),
    );
    return covers?.[0] || publication.images?.[0];
  }, [publication.images]);

  const imageUrl = coverImage ? resolveURL(coverImage.href, baseURL) : null;

  const authors = useMemo(() => {
    return publication.metadata?.author?.map((author) =>
      typeof author === 'string' ? author : author.name,
    );
  }, [publication.metadata?.author]);

  const acquisitionLinks = useMemo(() => {
    const links: Array<{ rel: string; links: OPDSLink[] }> = [];
    for (const [rel, linkList] of Array.from(linksByRel.entries())) {
      if (rel?.startsWith(REL.ACQ)) {
        links.push({ rel, links: linkList });
      }
    }
    return links;
  }, [linksByRel]);

  const handleActionButton = async (href: string, type?: string) => {
    if (downloadedBook) {
      navigateToReader(router, [downloadedBook.hash]);
      return;
    }

    setDownloading(true);
    setProgress(null);

    try {
      const book = await onDownload(href, type, (prog) => {
        if (prog.total > 0) {
          const percentage = Math.floor((prog.progress / prog.total) * 100);
          setProgress(percentage);
        }
      });
      if (book) {
        setDownloadedBook(book);
      }
      eventDispatcher.dispatch('toast', { type: 'success', message: _('Download completed') });
    } catch (error) {
      console.error('Download failed:', error);
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('Download failed') + `:\n${href}`,
      });
    } finally {
      setDownloading(false);
      setProgress(null);
    }
  };

  const getAcquisitionLabel = (rel: string): string => {
    if (rel === REL.ACQ + '/open-access') return _('Open Access');
    if (rel === REL.ACQ + '/borrow') return _('Borrow');
    if (rel === REL.ACQ + '/buy') return _('Buy');
    if (rel === REL.ACQ + '/subscribe') return _('Subscribe');
    if (rel === REL.ACQ + '/sample') return _('Sample');
    return _('Download');
  };

  const content = publication.metadata?.[SYMBOL.CONTENT];
  const description = publication.metadata?.description;

  return (
    <div className='flex w-full flex-col px-6 py-6'>
      <div className='mb-6 flex w-full flex-row items-start gap-6 max-[320px]:flex-col'>
        <div className='h-44 flex-shrink-0 sm:h-56 md:h-64'>
          <div className='bg-base-200 relative aspect-[28/41] h-full overflow-hidden rounded-none shadow-lg'>
            <CachedImage
              src={imageUrl}
              alt={publication.metadata?.title || 'Book cover'}
              fill
              className='object-cover'
              sizes='(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw'
              onGenerateCachedImageUrl={onGenerateCachedImageUrl}
            />
          </div>
        </div>

        <div className='flex h-44 min-w-0 flex-col justify-between max-[320px]:h-32 sm:h-56 md:h-64'>
          <div className='flex flex-col'>
            {publication.metadata?.subtitle && (
              <p className='text-base-content/60 mb-1 text-sm'>{publication.metadata.subtitle}</p>
            )}
            <h1 className='mb-2 text-base font-bold'>
              {publication.metadata?.title || 'Untitled'}
            </h1>
            {authors && authors.length > 0 && (
              <p className='text-base-content/70 text-sm'>{authors.join(', ')}</p>
            )}
          </div>

          {acquisitionLinks.length > 0 && (
            <div className='flex flex-wrap gap-2'>
              {acquisitionLinks.map(({ rel, links }) => (
                <div key={rel} className='flex gap-1'>
                  {links.length === 1 || downloadedBook ? (
                    <button
                      onClick={() => handleActionButton(links[0]!.href, links[0]!.type)}
                      disabled={downloading}
                      className={clsx(
                        'btn btn-primary min-w-20 rounded-3xl',
                        downloadedBook && 'btn-success',
                      )}
                    >
                      {downloadedBook ? _('Open & Read') : getAcquisitionLabel(rel)}
                    </button>
                  ) : (
                    <Dropdown
                      label={_('Download')}
                      className='dropdown-bottom flex justify-center'
                      buttonClassName={clsx(
                        'btn btn-ghost btn-primary min-w-20 rounded-3xl p-0 hover:bg-transparent',
                        downloadedBook && 'btn-success',
                      )}
                      disabled={downloading}
                      toggleButton={
                        <div>{downloadedBook ? _('Open') : getAcquisitionLabel(rel)}</div>
                      }
                    >
                      <div
                        className={clsx(
                          'delete-menu dropdown-content dropdown-center no-triangle',
                          'border-base-300 !bg-base-200 z-20 mt-2 max-w-[80vw] shadow-2xl',
                        )}
                      >
                        {links.map((link, idx: number) => (
                          <MenuItem
                            key={idx}
                            noIcon
                            transient
                            label={
                              link.title ||
                              getFileExtFromMimeType(link.type || '').toUpperCase() ||
                              idx.toString()
                            }
                            onClick={() => handleActionButton(link.href, link.type)}
                          />
                        ))}
                      </div>
                    </Dropdown>
                  )}
                </div>
              ))}
              <div className='flex h-12 w-12 items-center justify-center'>
                {downloading && progress && progress > 0 && (
                  <div
                    className='radial-progress flex items-center justify-center'
                    style={
                      {
                        '--value': progress,
                        '--size': '2.5rem',
                        fontSize: '0.6rem',
                        lineHeight: '0.8rem',
                      } as React.CSSProperties
                    }
                    aria-valuenow={progress || 0}
                    role='progressbar'
                  >
                    {progress}%
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className='max-w-xl items-start space-y-6'>
        {/* Description */}
        {(content || description) && (
          <div className='prose prose-sm max-w-none'>
            {content ? (
              <div
                dangerouslySetInnerHTML={{
                  __html:
                    content.type === 'html' || content.type === 'xhtml'
                      ? content.value
                      : content.value,
                }}
              />
            ) : (
              <p>{description}</p>
            )}
          </div>
        )}

        {/* Metadata Table */}
        <div>
          <style>
            {`
              .table :where(th, td) {
                padding: 10px 0px;
              }
            `}
          </style>
          <table className='table text-sm'>
            <tbody>
              {publication.metadata?.publisher && (
                <tr>
                  <th className='w-32'>{_('Publisher')}</th>
                  <td>
                    {typeof publication.metadata.publisher === 'string'
                      ? publication.metadata.publisher
                      : Array.isArray(publication.metadata.publisher)
                        ? publication.metadata.publisher
                            .map((p) => (typeof p === 'string' ? p : p.name))
                            .join(', ')
                        : publication.metadata.publisher.name}
                  </td>
                </tr>
              )}
              {publication.metadata?.published && (
                <tr>
                  <th>{_('Published')}</th>
                  <td>{formatDate(publication.metadata.published, true)}</td>
                </tr>
              )}
              {publication.metadata?.language && (
                <tr>
                  <th>{_('Language')}</th>
                  <td>
                    {Array.isArray(publication.metadata.language)
                      ? publication.metadata.language
                          .map((lang: string) => formatLanguage(lang))
                          .join(', ')
                      : formatLanguage(publication.metadata.language)}
                  </td>
                </tr>
              )}
              {publication.metadata?.identifier && (
                <tr>
                  <th>{_('Identifier')}</th>
                  <td>
                    <code className='text-xs'>{publication.metadata.identifier}</code>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Tags/Subjects */}
        {publication.metadata?.subject && publication.metadata.subject.length > 0 && (
          <div>
            <h2 className='mb-3 text-sm font-semibold'>{_('Tags')}</h2>
            <div className='flex flex-wrap gap-2'>
              {publication.metadata.subject.map((subject, index: number) => {
                const tag =
                  typeof subject === 'string' ? subject : subject.name || subject.code || _('Tag');
                return (
                  <div key={index} className='badge badge-outline max-w-full gap-1'>
                    <IoPricetag className='h-3 min-h-3 w-3 min-w-3' />
                    <div className='truncate' title={tag}>
                      {tag}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
